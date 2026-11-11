import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { readSchedule } from '../../src/features/owner/scheduleWorkbook.ts'

const store = { id: 'store-fixture', name: 'Toko Uji' }
const employees = [{ id: 'employee-fixture', name: 'Karyawan Uji', active: true }]
const month = '2026-11'
function workbook() {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Jadwal')
  sheet.addRow(['Jadwal', store.id, month])
  sheet.addRow(['Nama Karyawan', 'ID Karyawan', ...Array.from({ length: 30 }, (_, i) => String(i + 1))])
  return { book, sheet }
}
async function read(book) {
  const bytes = await book.xlsx.writeBuffer()
  return readSchedule(new globalThis.File([bytes], 'jadwal.xlsx'), store, month, employees)
}
test('Excel import ignores padding and styling beyond the template', async () => {
  const { book, sheet } = workbook()
  sheet.addRow([employees[0].name, employees[0].id, ' p ', '', 'O'])
  sheet.getCell('AZ600').font = { bold: true }
  sheet.getCell('BA601').value = ' '
  assert.deepEqual(await read(book), [
    { employee_id: employees[0].id, work_date: '2026-11-01', code: 'P' },
    { employee_id: employees[0].id, work_date: '2026-11-03', code: 'O' },
  ])
})
test('Excel import identifies invalid shift codes and values outside the month', async () => {
  const { book, sheet } = workbook()
  sheet.addRow([employees[0].name, employees[0].id, 'Q'])
  await assert.rejects(read(book), /baris 3, tanggal 1/)
  sheet.getCell('C3').value = 'S'
  sheet.getCell('AG3').value = 'P'
  await assert.rejects(read(book), /luar kolom tanggal pada baris 3/)
})
