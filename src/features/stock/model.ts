import { displayDate } from '../attendance/dates'

export type Quantity = [string, string]
export type Values = Record<string, Quantity>
export type Category = { id: string; name: string; sort_order: number; is_active: boolean }
export type MasterItem = Category & { category_id: string; unit_label: string; unit_type: 'single' | 'combined' }
export type StockItem = Pick<MasterItem, 'id' | 'name' | 'category_id' | 'unit_type' | 'unit_label'> & { category_name: string }
export type StockSettings = { guidelines_text: string; quick_presets: string[]; require_all_fields: boolean }
export type StockForm = {
  employee_name: string; store_name: string; report_date: string; version: string
  existing_id: string | null; settings: StockSettings; items: StockItem[]
}
export type StockReport = {
  id: string; employee_name: string; store_name: string; report_date: string
  created_at: string; updated_at: string; notes: string; guidelines_snapshot: string
}
export type ReportItem = {
  id: string; report_id: string; item_name_snapshot: string; category_id_snapshot: string
  category_name_snapshot: string; unit_snapshot: string; unit_type_snapshot: StockItem['unit_type']
  raw_value: string | null; secondary_value: string | null; status_flag: keyof typeof statusLabels
}
export type StockReceipt = { report: StockReport; items: ReportItem[] }

export const statusLabels = { empty: 'Stok habis', low: 'Menipis', ok: 'Tercatat', unfilled: 'Belum diisi' }
const integer = /^(?:-|[0-9]{1,12}|[0-9]{1,3}(?:\.[0-9]{3}){1,3})$/
export const validStockValue = (value: string) => integer.test(value) || /^[0-9]{1,6}\/[1-9][0-9]{0,5}$/.test(value)

export function validQuantity([main, extra]: Quantity, combined: boolean, required: boolean) {
  main = main.trim()
  extra = extra.trim()
  if (!main && !extra) return !required
  return combined ? integer.test(main) && integer.test(extra) : validStockValue(main) && !extra
}

export function groupStockItems<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const group = key(item)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(item)
  }
  return [...groups.values()]
}

export function displayStockQuantity(item: ReportItem) {
  if (item.raw_value === null) return 'Belum diisi'
  if (item.unit_type_snapshot === 'combined') return item.raw_value + ' kardus + ' + item.secondary_value + ' pcs'
  return item.raw_value + ' ' + item.unit_snapshot
}

export function whatsappStock({ report, items }: StockReceipt) {
  const sections = groupStockItems(items, item => item.category_id_snapshot).map(group =>
    ['*' + group[0].category_name_snapshot + '*', ...group.map(item => item.item_name_snapshot + ': ' + displayStockQuantity(item))].join('\n'))
  return [
    '*Format List SO Raw Material ' + report.store_name + '*',
    'Nama SO: ' + report.employee_name,
    'Tanggal SO: ' + displayDate(report.report_date),
    '',
    sections.join('\n\n'),
    '',
    '*Catatan*',
    ...(report.notes ? [report.notes] : []),
    report.guidelines_snapshot,
  ].join('\n')
}
