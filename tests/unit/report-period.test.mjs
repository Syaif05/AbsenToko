import { URL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodRange, validRange } from '../../src/features/owner/reportPeriod.ts'
import { reportRows, csvCell } from '../../src/features/owner/report.ts'
test('report periods respect Monday weeks and leap years', () => {
  assert.deepEqual(periodRange('week','2026-11-01'), ['2026-10-26','2026-11-01'])
  assert.deepEqual(periodRange('month','2024-02-12'), ['2024-02-01','2024-02-29'])
  assert.deepEqual(periodRange('year','2024-05-12'), ['2024-01-01','2024-12-31'])
  assert.ok(validRange('2024-01-01','2024-12-31'))
  assert.equal(validRange('2026-02-30','2026-03-01'),false)
  assert.equal(validRange('2026-11-02','2026-11-01'),false)
  assert.equal(validRange('2024-01-01','2025-01-01'),false)
})
test('reports retain historical store and calculate overnight duration without invented checkout', () => {
  const person={id:'a',name:'A',active:true,storeId:'new'}
  const record={employeeId:'a',storeId:'old',workDate:'2026-11-01',checkIn:{at:'2026-11-01T16:00:00Z'},checkOut:{at:'2026-11-01T18:30:00Z'}}
  const row=reportRows([person],[record],[{id:'old',name:'Old'}],record.workDate)[0]
  assert.equal(row.Toko,'Old')
  assert.equal(row['Durasi tercatat (jam)'],'2.50')
  assert.equal(reportRows([person],[{...record,checkOut:undefined}],[],record.workDate)[0]['Durasi tercatat (jam)'],'')
  assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"')
})

test('large reports fetch all pages and reject incomplete results', async () => {
  const { readFile } = await import('node:fs/promises')
  const { default: ts } = await import('typescript')
  const { default: vm } = await import('node:vm')
  const source = (await readFile(new URL('../../src/features/owner/api.ts', import.meta.url),'utf8')).split('export async function loadReportRecords')[1]
  let pages = 0
  let fail = false
  const api = { from() { return this }, select() { return this }, gte() { return this }, lte() { return this }, order() { return this }, range() { return this }, abortSignal() {
    pages++
    return Promise.resolve(fail ? {error: new Error('network')} : {data: Array.from({length: pages === 1 ? 500 : 1}, () => ({employee_id:'a',store_id:'b',work_date:'2026-01-01',check_in_at:'2026-01-01T01:00:00Z',check_out_at:null}))})
  } }
  const exports = {}
  vm.runInNewContext(ts.transpile('export async function loadReportRecords' + source, {module:ts.ModuleKind.CommonJS}), {exports, client:()=>api})
  const records = await exports.loadReportRecords('2026-01-01','2026-12-31',null)
  assert.equal(records.length,501)
  assert.equal(pages,2)
  fail=true
  await assert.rejects(exports.loadReportRecords('2026-01-01','2026-12-31',null),/belum bisa dimuat/)
})
