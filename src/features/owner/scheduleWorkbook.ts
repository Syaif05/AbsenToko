import type { Employee, Store } from '../attendance/types'
import type { ShiftCell } from './api'

export const shifts = {
  P: 'Pagi · 08:00–17:00',
  M: 'Midel · 11:00–19:00',
  S: 'Siang · 13:00–21:30',
  O: 'Libur',
} as const

export const validMonth = (month: string) => /^20\d\d-(0[1-9]|1[0-2])$/.test(month)

export function monthDays(month: string) {
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, i) => i + 1)
}

const dateFor = (month: string, day: number) => month + '-' + String(day).padStart(2, '0')

export async function downloadSchedule(store: Store, month: string, employees: Employee[], cells: ShiftCell[]) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Jadwal', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] })
  const days = monthDays(month)
  const byCell = new Map(cells.map(cell => [cell.employee_id + ':' + cell.work_date, cell.code]))
  sheet.addRow(['Jadwal ' + store.name, store.id, month])
  sheet.addRow(['Nama Karyawan', 'ID Karyawan', ...days])
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF164734' } }
  sheet.getRow(2).font = { bold: true }
  sheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9E5A4' } }
  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 38
  for (const day of days) sheet.getColumn(day + 2).width = 5
  for (const employee of employees) {
    const row = sheet.addRow([employee.name, employee.id, ...days.map(day => byCell.get(employee.id + ':' + dateFor(month, day)) ?? '')])
    for (const day of days) row.getCell(day + 2).dataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: true, formulae: ['"P,M,S,O"'],
    }
  }
  const guide = book.addWorksheet('Petunjuk')
  guide.getColumn(1).width = 74
  guide.addRows([
    ['Isi kode pada kolom tanggal di tab Jadwal.'],
    ['Pertahankan ID karyawan, nama tab dan dua baris pertama.'],
    ['Sel kosong tidak mengubah jadwal yang sudah tersimpan.'],
    ...Object.entries(shifts).map(([code, label]) => [code + ' — ' + label]),
  ])
  const bytes = await book.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'jadwal-' + month + '.xlsx'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readSchedule(file: File, store: Store, month: string, employees: Employee[]): Promise<ShiftCell[]> {
  if (!/\.xlsx$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
    throw new Error('Pilih file Excel .xlsx maksimal 2 MB.')
  }
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await file.arrayBuffer())
  const sheet = book.getWorksheet('Jadwal')
  const days = monthDays(month)
  if (!sheet || sheet.getCell('B1').value !== store.id || sheet.getCell('C1').value !== month
      || sheet.getCell('B2').value !== 'ID Karyawan' || days.some(day => sheet.getRow(2).getCell(day + 2).value !== day)) {
    throw new Error('Template tidak cocok dengan toko atau bulan yang dipilih. Unduh template dari pilihan ini.')
  }
  if (sheet.rowCount > 502 || sheet.columnCount > days.length + 2) throw new Error('Ukuran tabel melebihi format template.')
  const allowed = new Set(employees.map(employee => employee.id))
  const seen = new Set<string>()
  const result: ShiftCell[] = []
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    if (!row.hasValues) continue
    const id = row.getCell(2).value
    if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) {
      throw new Error('ID karyawan tidak dikenal atau berulang pada baris ' + rowNumber + '.')
    }
    seen.add(id)
    for (const day of days) {
      const value = row.getCell(day + 2).value
      if (value === null || (typeof value === 'string' && !value.trim())) continue
      const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
      if (!Object.hasOwn(shifts, code)) throw new Error('Kode shift tidak valid pada baris ' + rowNumber + ', tanggal ' + day + '.')
      result.push({ employee_id: id, work_date: dateFor(month, day), code: code as ShiftCell['code'] })
    }
  }
  if (!result.length) throw new Error('Isi minimal satu kode shift sebelum mengunggah.')
  return result
}
