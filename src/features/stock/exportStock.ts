import { csvCell } from '../owner/report'
import { contributorNames, displayStockQuantity, statusLabels } from './model'
import { displayTime } from '../attendance/dates'
import { stockExportRows } from './ownerStock'
import type { StockFilters } from './ownerStock'

export async function exportStock(format: 'xlsx' | 'csv', filters: StockFilters) {
  const rows = [['Tanggal WIB', 'Toko', 'Pengisi SO', 'Kategori', 'Barang', 'Satuan', 'Jumlah', 'Status',
    'Catatan', 'ID Laporan', 'Editor terakhir', 'Waktu perubahan (WIB)']]
  for await (const { report, items } of stockExportRows(filters)) {
    for (const item of items) {
      rows.push([report.report_date, report.store_name, contributorNames(report).join(', '), item.category_name_snapshot,
        item.item_name_snapshot, item.unit_snapshot, displayStockQuantity(item), statusLabels[item.status_flag], report.notes,
        report.id, item.last_editor ?? (report.catalog_version ? '' : report.employee_name),
        item.last_edit_at ? displayTime(item.last_edit_at) : ''])
    }
  }
  if (rows.length === 1) throw new Error('Tidak ada laporan pada filter ini.')
  let file: Blob
  if (format === 'xlsx') {
    const { Workbook } = await import('exceljs')
    const book = new Workbook()
    const sheet = book.addWorksheet('Stock Opname', { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRows(rows)
    sheet.getRow(1).font = { bold: true }
    sheet.columns.forEach((column, index) => { column.width = [16, 25, 36, 32, 32, 19, 24, 16, 35, 38, 25, 25][index] })
    file = new Blob([new Uint8Array(await book.xlsx.writeBuffer())], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  } else {
    file = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  }
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'stock-opname-' + (filters.start || 'awal') + '-' + (filters.end || 'akhir') + '.' + format
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
