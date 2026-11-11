import type { Employee, Store } from '../attendance/types'
import type { ShiftCell } from './api'

import { shifts, monthDays } from '../attendance/schedule.ts'
export { shifts, validMonth, monthDays } from '../attendance/schedule.ts'

const dateFor = (month: string, day: number) => month + '-' + String(day).padStart(2, '0')

export async function downloadSchedule(
  store: Store,
  month: string,
  employees: Employee[],
  cells: ShiftCell[],
) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Jadwal', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] })
  const days = monthDays(month)
  const byCell = new Map(cells.map((cell) => [cell.employee_id + ':' + cell.work_date, cell.code]))
  sheet.addRow(['Jadwal ' + store.name, store.id, month, 'P Pagi · M Midel · S Siang · O Libur'])
  sheet.addRow(['Nama Karyawan', 'ID Karyawan', ...days])
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF164734' } }
  sheet.getRow(2).font = { bold: true }
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9E5A4' } }
  sheet.getColumn(1).width = 28
  sheet.getColumn(2).hidden = true
  for (const day of days) sheet.getColumn(day + 2).width = 5
  for (const employee of employees) {
    const row = sheet.addRow([
      employee.name,
      employee.id,
      ...days.map((day) => byCell.get(employee.id + ':' + dateFor(month, day)) ?? ''),
    ])
    for (const day of days)
      row.getCell(day + 2).dataValidation = {
        type: 'list',
        allowBlank: true,
        showErrorMessage: true,
        formulae: ['"P,M,S,O"'],
      }
  }
  const bytes = await book.xlsx.writeBuffer()
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'jadwal-' + month + '.xlsx'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readSchedule(
  file: File,
  store: Store,
  month: string,
  employees: Employee[],
): Promise<ShiftCell[]> {
  if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
    throw new Error('Pilih file Excel .xlsx maksimal 2 MB.')
  }
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  try {
    await book.xlsx.load(await file.arrayBuffer())
  } catch {
    throw new Error('File Excel tidak bisa dibaca. Simpan kembali sebagai .xlsx.')
  }
  const sheet = book.getWorksheet('Jadwal')
  const days = monthDays(month)
  if (
    !sheet ||
    sheet.getCell('B1').value !== store.id ||
    sheet.getCell('C1').value !== month ||
    sheet.getCell('B2').value !== 'ID Karyawan' ||
    days.some((day) => String(sheet.getRow(2).getCell(day + 2).value).trim() !== String(day))
  ) {
    throw new Error(
      'Template tidak cocok dengan toko atau bulan yang dipilih. Unduh template dari pilihan ini.',
    )
  }
  const allowed = new Set(employees.map((employee) => employee.id))
  const seen = new Set<string>()
  const result: ShiftCell[] = []
  const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim())
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return
    const id = row.getCell(2).value
    const filled = days.filter((day) => !blank(row.getCell(day + 2).value))
    row.eachCell((cell, column) => {
      if (column > days.length + 2 && !blank(cell.value)) {
        throw new Error('Ada isi di luar kolom tanggal pada baris ' + rowNumber + '.')
      }
    })
    if (!filled.length) return
    if (typeof id !== 'string' || !allowed.has(id.trim()) || seen.has(id.trim())) {
      throw new Error('ID karyawan tidak dikenal atau berulang pada baris ' + rowNumber + '.')
    }
    seen.add(id.trim())
    for (const day of filled) {
      const value = row.getCell(day + 2).value
      const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
      if (!Object.hasOwn(shifts, code)) {
        throw new Error('Kode shift tidak valid pada baris ' + rowNumber + ', tanggal ' + day + '.')
      }
      result.push({
        employee_id: id.trim(),
        work_date: dateFor(month, day),
        code: code as ShiftCell['code'],
      })
    }
  })
  if (result.length > 15500) throw new Error('Unggah maksimal 15.500 sel shift per file.')
  if (!result.length) throw new Error('Isi minimal satu kode shift sebelum mengunggah.')
  return result
}
