import { displayDate } from '../attendance/dates'

export type Quantity = [string, string]
export type Values = Record<string, Quantity>
export type Category = { id: string; name: string; sort_order: number; is_active: boolean }
export type MasterItem = Category & { category_id: string; unit_label: string; unit_type: 'single' | 'combined' }
export type StockItem = Pick<MasterItem, 'id' | 'name' | 'category_id' | 'unit_type' | 'unit_label'> & { category_name: string }
export type StockSettings = { guidelines_text: string; require_all_fields: boolean }
export type SharedStockItem = StockItem & {
  revision?: number
  values?: [string | null, string | null]
  last_editor?: string | null
}
export type StockForm = {
  employee_name: string; store_name: string; report_date: string; version: string
  report_id: string | null; requires_all: boolean; items: SharedStockItem[]
  contributors: string[]; guidelines: string
  soh_checks?: boolean
}
export type StockReport = {
  id: string; employee_name: string; store_name: string; report_date: string
  created_at: string; updated_at: string; notes: string; guidelines_snapshot: string
  catalog_version: string | null; contributors: Record<string, string>
  requires_all: boolean; filled_count: number; item_count: number
}
export type ReportItem = {
  id: string; report_id: string; item_name_snapshot: string; category_id_snapshot: string
  category_name_snapshot: string; unit_snapshot: string; unit_type_snapshot: StockItem['unit_type']
  raw_value: string | null; secondary_value: string | null; status_flag: keyof typeof statusLabels
  last_editor: string | null; last_edit_at: string | null
}
export type StockReceipt = { report: StockReport; items: ReportItem[] }

export const statusLabels = { empty: 'Stok habis', low: 'Menipis', ok: 'Tercatat', unfilled: 'Belum diisi' }
const integer = /^(?:-|[0-9]{1,12}|[0-9]{1,3}(?:\.[0-9]{3}){1,3})$/
const validStockValue = (value: string) => integer.test(value) || /^[0-9]{1,6}\/[1-9][0-9]{0,5}$/.test(value)

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

type StockQuantity = Pick<ReportItem, 'raw_value' | 'secondary_value' | 'unit_snapshot' | 'unit_type_snapshot'>

export function displayStockQuantity(item: StockQuantity) {
  if (item.raw_value === null) return 'Belum diisi'
  if (item.unit_type_snapshot === 'combined') return item.raw_value + ' kardus + ' + item.secondary_value + ' pcs'
  return item.raw_value + ' ' + item.unit_snapshot
}

type WhatsAppStock = {
  report: Pick<StockReport, 'store_name' | 'report_date' | 'notes' | 'guidelines_snapshot'>
  names: string[]
  items: (StockQuantity & Pick<ReportItem, 'category_id_snapshot' | 'category_name_snapshot' | 'item_name_snapshot'>)[]
}

export function contributorNames(report: StockReport) {
  return report.catalog_version ? Object.values(report.contributors) : [report.employee_name]
}

const safeLine = (value: string) => value.replace(/[\p{Cc}\p{Cf}*_~`]/gu, ' ').replace(/ +/g, ' ').trim()
const safeNotes = (value: string) => value.split(/\r?\n/).map(line => '  • ' + safeLine(line)).join('\n')

export function whatsappStock({ report, items, names }: WhatsAppStock) {
  const sections = groupStockItems(items, item => item.category_id_snapshot).map(group =>
    ['*' + safeLine(group[0].category_name_snapshot) + '*', ...group.map(item => safeLine(item.item_name_snapshot) + ': ' + safeLine(displayStockQuantity(item)))].join('\n'))
  return [
    '*Format List SO Raw Material ' + safeLine(report.store_name) + '*',
    'Pengisi SO: ' + names.map(safeLine).join(', '),
    'Tanggal SO: ' + displayDate(report.report_date),
    '',
    sections.join('\n\n'),
    '',
    '*Catatan*',
    ...(report.notes ? [safeNotes(report.notes)] : []),
    safeNotes(report.guidelines_snapshot),
  ].join('\n')
}
