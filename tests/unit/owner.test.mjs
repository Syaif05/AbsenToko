import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
import vm from 'node:vm'
const { URL, Response, Request, Headers, TextDecoder, AbortSignal, crypto } = globalThis

async function loadModule(path) {
  const source = await fs.readFile(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS })
  const exports = {}
  vm.runInNewContext(compiled, { exports })
  return exports
}
const { dashboardRows } = await loadModule('../../src/features/owner/dashboard.ts')
const people = [
  { id: 'a', name: 'A', active: true, storeId: 'new' },
  { id: 'b', name: 'B', active: false, storeId: 'old', archivedAt: '2026-01-01' },
  { id: 'c', name: 'C', active: true, storeId: 'new' },
]
const records = [
  { employeeId: 'a', storeId: null },
  { employeeId: 'b', storeId: 'old', checkOut: {} },
]
test('historical unknown store has its own filter and preserves archived employees', () => {
  assert.equal(dashboardRows(people, records, '').length, 3)
  assert.equal(dashboardRows(people, records, 'unassigned')[0].employee.id, 'a')
  assert.equal(dashboardRows(people, records, 'old')[0].employee.id, 'b')
  assert.equal(dashboardRows(people, records, 'new').length, 1)
  assert.equal(dashboardRows(people, records, 'new')[0].employee.id, 'c')
})
test('employee transfers keep attendance with the historical store', () => {
  const rows = dashboardRows(people, [{ employeeId: 'a', storeId: 'old' }], 'old')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'working')
  assert.equal(dashboardRows(people, [], '').length, 2)
})

async function endpoint(overrides = {}) {
  let handler
  const calls = []
  const admin = {
    auth: { getUser: async () => ({ data: { user: overrides.noUser ? null : { id: 'owner' } } }) },
    from: () => ({
      select: () => ({
        eq() {
          return this
        },
        maybeSingle: async () => ({ data: overrides.nonOwner ? null : { user_id: 'owner' } }),
      }),
    }),
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'attendance_take_limit') return { data: !overrides.limited }
      return overrides.rpcResult ?? { data: { ok: true, replayed: true } }
    },
  }
  let source = await fs.readFile(
    new URL('../../supabase/functions/owner-api/index.ts', import.meta.url),
    'utf8',
  )
  source = source.replace(/import .*?\n/, 'const createClient = () => admin\n')
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS }), {
    admin,
    exports: {},
    Response,
    Request,
    Headers,
    TextDecoder,
    AbortSignal,
    crypto,
    Deno: {
      env: { get: (key) => (key === 'ALLOWED_ORIGINS' ? 'https://test.example' : 'test') },
      serve: (fn) => {
        handler = fn
      },
    },
  })
  const invoke = (body, auth = true) =>
    handler(
      new Request('https://test.example', {
        method: 'POST',
        headers: {
          origin: 'https://test.example',
          ...(auth ? { authorization: 'Bearer token' } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
  return { invoke, calls }
}
const request = {
  operation: 'create_store',
  id: '10000000-0000-4000-8000-000000000001',
  request_id: '20000000-0000-4000-8000-000000000001',
  name: 'Toko Uji',
}
test('owner endpoint rejects unauthenticated and non-owner requests before writes', async () => {
  const anonymous = await endpoint()
  assert.equal((await anonymous.invoke(request, false)).status, 401)
  const ordinary = await endpoint({ nonOwner: true })
  assert.equal((await ordinary.invoke(request)).status, 403)
  assert.equal(ordinary.calls.length, 0)
})
test('write passes stable request identity and returns confirmed receipt', async () => {
  const api = await endpoint()
  const response = await api.invoke(request)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).replayed, true)
  assert.equal(api.calls.at(-1).args.p_request, request.request_id)
})
test('invalid input, throttling and unconfirmed commits never succeed', async () => {
  const api = await endpoint()
  assert.equal((await api.invoke({ ...request, request_id: 'bad' })).status, 400)
  assert.equal((await api.invoke([])).status, 400)
  assert.equal((await (await endpoint({ limited: true })).invoke(request)).status, 429)
  assert.equal((await (await endpoint({ rpcResult: { data: null } })).invoke(request)).status, 503)
  const missing = await endpoint({ rpcResult: { error: { code: 'PGRST202' } } })
  assert.equal((await missing.invoke(request)).status, 503)
})
