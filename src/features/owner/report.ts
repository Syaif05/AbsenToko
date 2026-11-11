import type { Attendance, Employee, Store } from '../attendance/types'

export type ReportFormat = 'xlsx' | 'csv' | 'json' | 'print'
const timestamp = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short',
})

export function reportRows(employees: Employee[], records: Attendance[], stores: Store[], date: string) {
  const byEmployee = new Map(records.map(record => [record.employeeId, record]))
  const storeNames = new Map(stores.map(store => [store.id, store.name]))
  return employees.map(employee => {
    const record = byEmployee.get(employee.id)
    return {
      Tanggal: date,
      Nama: employee.name,
      Toko: record
        ? storeNames.get(record.storeId ?? '') ?? 'Toko historis belum tercatat'
        : storeNames.get(employee.storeId ?? '') ?? 'Belum ditempatkan',
      Status: record?.checkOut ? 'Selesai' : record ? 'Sedang Bekerja' : 'Belum Masuk',
      'Masuk (WIB)': record ? timestamp.format(new Date(record.checkIn.at)) : '',
      'Pulang (WIB)': record?.checkOut ? timestamp.format(new Date(record.checkOut.at)) : '',
    }
  })
}

export function csvCell(value: string) {
  // Spreadsheet programs may interpret user-controlled names as formulas.
  const safe = /^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}

export async function exportReport(format: ReportFormat, rows: ReturnType<typeof reportRows>, date: string, store: string) {
  const headers = ['Tanggal', 'Nama', 'Toko', 'Status', 'Masuk (WIB)', 'Pulang (WIB)']
  if (format === 'print') {
    const popup = window.open('', '_blank')
    if (!popup) throw new Error('Izinkan popup untuk membuka laporan PDF.')
    const doc = popup.document
    doc.title = 'Laporan absensi ' + date
    doc.documentElement.lang = 'id'
    const style = doc.createElement('link')
    style.rel = 'stylesheet'
    style.href = new URL('/report-print.css', location.origin).href
    doc.head.append(style)
    const heading = doc.createElement('h1')
    heading.textContent = 'Laporan absensi'
    const subtitle = doc.createElement('p')
    subtitle.textContent = date + ' · ' + store + ' · Waktu Asia/Jakarta (WIB)'
    const print = doc.createElement('button')
    print.textContent = 'Cetak / Simpan sebagai PDF'
    print.addEventListener('click', () => popup.print())
    const table = doc.createElement('table')
    const head = table.createTHead().insertRow()
    for (const label of headers) {
      const cell = doc.createElement('th')
      cell.textContent = label
      head.append(cell)
    }
    const body = table.createTBody()
    for (const row of rows) {
      const tr = body.insertRow()
      for (const value of Object.values(row)) tr.insertCell().textContent = value || '—'
    }
    doc.body.replaceChildren(heading, subtitle, print, table)
    popup.opener = null
    doc.close()
    return
  }
  let file: Blob
  if (format === 'xlsx') {
    const { default: ExcelJS } = await import('exceljs')
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Absensi', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRow(headers).font = { bold: true }
    const widths = [15, 28, 26, 22, 24, 24]
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
    sheet.addRows(rows.map(row => Object.values(row)))
    sheet.autoFilter = 'A1:F1'
    file = new Blob([new Uint8Array(await book.xlsx.writeBuffer())], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  } else {
    const content = format === 'json'
      ? JSON.stringify({ tanggal: date, toko: store, zonaWaktu: 'Asia/Jakarta', data: rows }, null, 2)
      : '\uFEFF' + [headers, ...rows.map(row => Object.values(row))].map(row => row.map(csvCell).join(',')).join('\r\n')
    file = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' })
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = 'absensi-' + date + '.' + format
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
