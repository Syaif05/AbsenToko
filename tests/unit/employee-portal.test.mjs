import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
import vm from 'node:vm'
const { URL, Response, Request, Headers, TextDecoder, TextEncoder, crypto } = globalThis

async function endpoint(invalidSession = false) {
  let handler
  const calls = []
  const admin = {
    storage: { from: () => ({}) },
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'attendance_take_limit') return { data: true }
      return invalidSession ? { error: { code: 'P0001', message: 'invalid session' } } : { data: { days: [] } }
    },
  }
  let source = await fs.readFile(new URL('../../supabase/functions/attendance-api/index.ts', import.meta.url), 'utf8')
  source = source.replace(/^import .*\n/gm, '')
  const code = ts.transpile('async function boot() { const createClient = () => admin;\n' + source + '\n} boot()', { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  await vm.runInNewContext(code, { admin, exports: {}, Response, Request, Headers, TextDecoder, TextEncoder, crypto,
    Deno: { env: { get: key => key === 'ALLOWED_ORIGINS' ? 'https://test.example' : 'a'.repeat(32) }, serve: fn => { handler = fn } },
  })
  return { calls, invoke: (body, token = 'a'.repeat(64)) => handler(new Request('https://test.example', {
    method: 'POST', headers: { origin: 'https://test.example', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body),
  })) }
}
test('schedule endpoint requires a session and valid month', async () => {
  const { invoke, calls } = await endpoint()
  assert.equal((await invoke({operation:'schedule',month:'2026-11'}, '')).status, 401)
  assert.equal((await invoke({operation:'schedule',month:'2026-13'})).status, 400)
  assert.equal(calls.filter(call => call.name === 'attendance_my_schedule').length, 0)
})
test('schedule endpoint derives identity from hashed token, ignores supplied employee ID', async () => {
  const { invoke, calls } = await endpoint()
  const response = await invoke({operation:'schedule', month:'2026-11', employee_id:'another-employee'})
  assert.equal(response.status, 200)
  const args = calls.find(call => call.name === 'attendance_my_schedule').args
  assert.equal(args.p_month, '2026-11-01')
  assert.equal(args.p_hash.length, 64)
  assert.notEqual(args.p_hash, 'a'.repeat(64))
  assert.deepEqual(Object.keys(args).sort(), ['p_hash','p_month'])
})
test('revoked schedule session returns 401 without database details', async () => {
  const { invoke } = await endpoint(true)
  const response = await invoke({operation:'schedule',month:'2026-11'})
  assert.equal(response.status, 401)
  assert.match((await response.json()).error, /Sesi berakhir/)
})
