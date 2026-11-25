import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import vm from 'node:vm'

const { URL, crypto, Request, Response, Headers, File, FormData, TextEncoder, TransformStream } = globalThis

const id = '10000000-0000-4000-8000-000000000001'
const employee = '20000000-0000-4000-8000-000000000002'
const employeeToken = 'b'.repeat(64)
const origin = 'https://test.example'
const png = new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13])], 'uji.png', { type: 'image/png' })
const audio = new File([new Uint8Array([26,69,223,163,0,0,0,0,0,0,0,0])], 'uji.webm', { type: 'audio/webm' })

async function setup() {
  let handler
  let uploadError = false
  const rows = new Map()
  const files = new Map()
  const calls = []
  const admin = {
    auth: { getUser: async token => ({ data: { user: token === 'owner-jwt' ? { id } : null } }) },
    storage: { from: () => ({
      upload: async (path, file) => {
        if (uploadError && file.type === 'audio/webm') return { error: { message: 'fixture' } }
        files.set(path, file)
        return { data: { path } }
      },
      remove: async paths => { paths.forEach(path => files.delete(path)); return {} },
      createSignedUrls: async paths => ({ data: paths.map(path => ({ signedUrl: origin + '/media/' + path })) }),
    }) },
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'attendance_take_limit') return { data: true }
      return { data: { id: employee, name: 'Pengisi Uji' } }
    },
    from(table) {
      let values, insert = false, deleting = false
      const predicates = []
      function run() {
        if (table === 'owner_profiles') return { data: { user_id: id } }
        if (insert) {
          if (rows.has(values.id)) return { error: { code: '23505' } }
          rows.set(values.id, { status: 'receiving', ...values })
          return { data: { ...rows.get(values.id) } }
        }
        const row = [...rows.values()].find(entry => predicates.every(fn => fn(entry)))
        if (!row) return { data: null }
        if (deleting) rows.delete(row.id)
        if (values) Object.assign(row, values)
        return { data: { ...row } }
      }
      return {
        insert(fields) { insert = true; values = fields; return this },
        update(fields) { values = fields; return this },
        delete() { deleting = true; return this },
        eq(key, value) { predicates.push(row => row[key] === value); return this },
        neq(key, value) { predicates.push(row => row[key] !== value); return this },
        select() { return this },
        maybeSingle: async () => run(),
        single: async () => run(),
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
      }
    },
  }
  const source = await readFile(new URL('../../supabase/functions/issue-reports/index.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpile(source.replace(/^import .*\n/, 'const createClient = () => fixture\n'), {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }), {
    fixture: admin, exports: {}, crypto, Request, Response, Headers, File, TextEncoder, TransformStream,
    Deno: { env: { get: key => key === 'ALLOWED_ORIGINS' ? origin : 'test' }, serve: fn => { handler = fn } },
  })
  function invoke(body, token = employeeToken) {
    return handler(new Request(origin, {
      method: 'POST', headers: {
        origin, ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      }, body: body instanceof FormData ? body : JSON.stringify(body),
    }))
  }
  return { invoke, rows, files, calls, failUploads: failed => { uploadError = failed } }
}

function report(images = [], voice = null, page = '/') {
  const body = new FormData()
  body.set('id', id)
  body.set('page', page)
  body.set('message', 'Tombol jadwal tidak membuka daftar bulan.')
  body.set('reporter_id', 'untrusted')
  images.forEach(file => body.append('image', file))
  if (voice) body.set('audio', voice)
  return body
}

test('issue intake rejects anonymous, excess or invalid attachments, and foreign page context', async () => {
  const { invoke, rows, files } = await setup()
  assert.equal((await invoke(report(), '')).status, 401)
  assert.equal((await invoke(report(Array(6).fill(png)))).status, 400)
  const fakeImage = new File(['<script>no image</script>'], 'fixture.png', { type: 'image/png' })
  assert.equal((await invoke(report([fakeImage]))).status, 400)
  assert.equal((await invoke(report([], null, '/owner/jadwal'))).status, 400)
  assert.equal(rows.size + files.size, 0)
})

test('issue attachment failure cleans the draft, retry is idempotent, only Owner can sign or update', async () => {
  const { invoke, rows, files, calls, failUploads } = await setup()
  failUploads(true)
  assert.equal((await invoke(report([png], audio))).status, 503)
  assert.equal(rows.size + files.size, 0)
  failUploads(false)
  const sent = await invoke(report(Array(5).fill(png), audio))
  assert.equal(sent.status, 200)
  assert.deepEqual(await sent.json(), { id })
  assert.equal(rows.get(id).reporter_id, employee)
  const session = calls.find(call => call.name === 'website_issue_employee')
  assert.equal(session.args.p_hash.length, 64)
  assert.notEqual(session.args.p_hash, employeeToken)
  const replay = await invoke(report(Array(5).fill(png), audio))
  assert.equal(replay.status, 200)
  assert.equal(files.size, 6)
  assert.equal((await invoke({ operation: 'media', id })).status, 403)
  assert.equal((await invoke({ operation: 'status', id, status: 'resolved' })).status, 403)
  const media = await (await invoke({ operation: 'media', id }, 'owner-jwt')).json()
  assert.deepEqual(media.attachments.map(file => file.kind), ['image', 'image', 'image', 'image', 'image', 'audio'])
  assert.equal((await invoke({ operation: 'status', id, status: 'resolved' }, 'owner-jwt')).status, 200)
  assert.equal(rows.get(id).status, 'resolved')
})

test('Owner can submit a text-only issue from the current Owner page', async () => {
  const { invoke, rows, files } = await setup()
  assert.equal((await invoke(report([], null, '/owner/stock-opname'), 'owner-jwt')).status, 200)
  assert.equal(rows.get(id).reporter_role, 'owner')
  assert.equal(rows.get(id).page, '/owner/stock-opname')
  assert.equal(files.size, 0)
})

test('long recordings fit the audio limit while recordings over 6 MiB are rejected', async () => {
  const { invoke, files } = await setup()
  const recording = size => new File([audio, new Uint8Array(size - audio.size)], 'uji.webm', { type: 'audio/webm' })
  assert.equal((await invoke(report([], recording(6 * 1024 * 1024 + 1)))).status, 400)
  assert.equal((await invoke(report([], recording(5 * 1024 * 1024)))).status, 200)
  assert.equal([...files.values()][0].size, 5 * 1024 * 1024)
})
