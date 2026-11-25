import { ownerClient } from '../owner/api'
import type { Category, MasterItem, ReportItem, StockReceipt, StockReport, StockSettings } from './model'

function client() {
  if (!ownerClient) throw new Error('Konfigurasi Owner belum tersedia.')
  return ownerClient
}

export type StockFilters = { start: string; end: string; name: string }
export const stockPageSize = 25
const header = 'id,employee_name,store_name,report_date,created_at,updated_at,notes,guidelines_snapshot,catalog_version,contributors,requires_all,filled_count,item_count'
const lines = 'so_report_items(id,report_id,item_name_snapshot,category_id_snapshot,category_name_snapshot,unit_snapshot,unit_type_snapshot,raw_value,secondary_value,status_flag,sort_order,last_editor,last_edit_at)'

function reportsQuery(columns: string, { start, end, name }: StockFilters) {
  let query = client().from('so_reports').select(columns)
    .order('report_date', { ascending: false }).order('created_at', { ascending: false }).order('id')
  if (start) query = query.gte('report_date', start)
  if (end) query = query.lte('report_date', end)
  if (name.trim()) query = query.ilike('search_names', '%' + name.trim().replace(/[%_\\*]/g, '\\$&') + '%')
  return query
}

export async function stockReports(filters: StockFilters, page: number, signal: AbortSignal) {
  const from = page * stockPageSize
  const { data, error } = await reportsQuery(header, filters).range(from, from + stockPageSize).abortSignal(signal)
    .returns<StockReport[]>()
  if (error) throw new Error('Daftar laporan SO belum bisa dimuat.')
  return { rows: data.slice(0, stockPageSize), more: data.length > stockPageSize }
}

type DetailRow = StockReport & { so_report_items: (ReportItem & { sort_order: number })[] }

function receiptFromRow({ so_report_items, ...report }: DetailRow): StockReceipt {
  return { report, items: so_report_items.sort((a, b) => a.sort_order - b.sort_order) }
}

export async function stockDetail(id: string) {
  const { data, error } = await client().from('so_reports').select(header + ',' + lines).eq('id', id)
    .abortSignal(AbortSignal.timeout(20_000)).returns<DetailRow[]>().single()
  if (error) throw new Error('Laporan belum bisa dibuka. Coba muat kembali daftar.')
  return receiptFromRow(data)
}

export type StockChange = {
  id: string; actor_name: string; recorded_at: string; note: string
  changes: { item: string; before: (string | null)[]; after: (string | null)[] }[]
}

export async function stockHistory(id: string, offset: number) {
  const { data, error } = await client().from('so_revisions').select('id,actor_name,recorded_at,note,changes')
    .eq('report_id', id).neq('action', 'delete').order('recorded_at', { ascending: false }).order('id')
    .range(offset, offset + 19).abortSignal(AbortSignal.timeout(15_000)).returns<StockChange[]>()
  if (error) throw new Error('Riwayat perubahan belum bisa dimuat.')
  return data
}

export async function* stockExportRows(filters: StockFilters) {
  const pageSize = 50
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await reportsQuery(header + ',' + lines, filters).range(offset, offset + pageSize - 1)
      .abortSignal(AbortSignal.timeout(30_000)).returns<DetailRow[]>()
    if (error) throw new Error('Ekspor belum selesai. Coba lagi atau perkecil rentang tanggal.')
    for (const report of data) yield receiptFromRow(report)
    if (data.length < pageSize) return
  }
}

async function readRows<T>(buildPage: (from: number) => PromiseLike<{ data: T[] | null; error: unknown }>, message: string) {
  const rows: T[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await buildPage(from)
    if (error || !data) throw new Error(message)
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

function readCatalog<T>(table: 'so_categories' | 'so_items', signal: AbortSignal) {
  return readRows<T>(from => client().from(table).select('*').order('sort_order').order('name').order('id')
    .range(from, from + 499).abortSignal(signal).returns<T[]>(), 'Daftar barang SO belum bisa dimuat.')
}

export async function stockMaster(signal: AbortSignal) {
  const [categories, items, settings] = await Promise.all([
    readCatalog<Category>('so_categories', signal),
    readCatalog<MasterItem>('so_items', signal),
    client().from('so_settings').select('guidelines_text,require_all_fields')
      .eq('id', 1).abortSignal(signal).returns<StockSettings[]>().single(),
  ])
  if (settings.error) throw new Error('Pengaturan Stock Opname gagal dimuat.')
  return { categories, items, settings: settings.data }
}

type StoredQuantity = [string, string | null]
export type OnHand = {
  item_id: string; quantity: StoredQuantity; unit_type: MasterItem['unit_type']; unit_label: string
  units_per_box: number | null; updated_at: string
}
export type OnHandChange = {
  id: number; item_name: string; unit_label: string; before_quantity: StoredQuantity | null; before_unit_label: string | null
  quantity: StoredQuantity; actor_name: string; report_id: string | null; note: string; recorded_at: string
}

export class OnHandUnavailable extends Error {}

export async function onHandDirectory(signal: AbortSignal) {
  const [categories, items, stores] = await Promise.all([
    readCatalog<Category>('so_categories', signal),
    readCatalog<MasterItem>('so_items', signal),
    readRows<{ id: string; name: string }>(from => client().from('stores').select('id,name').is('archived_at', null)
      .order('name').order('id').range(from, from + 499).abortSignal(signal), 'Daftar toko belum bisa dimuat.'),
  ])
  const names = new Map(categories.filter(category => category.is_active).map(category => [category.id, category.name]))
  return { stores, items: items.filter(item => item.is_active && names.has(item.category_id))
    .map(item => ({ ...item, category_name: names.get(item.category_id)! })) }
}

export async function onHandStore(storeId: string, signal: AbortSignal) {
  const [stock, history] = await Promise.all([
    readRows<OnHand>(async from => {
      const page = await client().from('so_on_hand').select('item_id,quantity,unit_type,unit_label,units_per_box,updated_at')
        .eq('store_id', storeId).order('item_id').range(from, from + 499).abortSignal(signal).returns<OnHand[]>()
      if (page.error?.code === 'PGRST205' || page.error?.code === '42P01') throw new OnHandUnavailable()
      return page
    }, 'Stock on hand belum bisa dimuat.'),
    client().from('so_on_hand_history').select('id,item_name,unit_label,before_quantity,before_unit_label,quantity,actor_name,report_id,note,recorded_at')
      .eq('store_id', storeId).order('id', { ascending: false }).limit(20).abortSignal(signal).returns<OnHandChange[]>(),
  ])
  if (history.error) throw new Error('Riwayat perubahan SOH belum bisa dimuat.')
  return { stock, history: history.data }
}

export async function writeStockMaster(table: 'so_categories' | 'so_items', id: string, creating: boolean,
  fields?: Omit<Category, 'id'> | Omit<MasterItem, 'id'>) {
  const db = client().from(table)
  const query = !fields ? db.delete().eq('id', id) : creating ? db.insert({ id, ...fields }) : db.update(fields).eq('id', id)
  const { data, error } = await query.select('id').abortSignal(AbortSignal.timeout(20_000)).single()
  if (error?.code === '23505') throw new Error('Nama ini sudah dipakai. Gunakan nama lain.')
  if (error?.code === '23503') throw new Error('Pindahkan atau hapus barang di kategori ini terlebih dahulu.')
  if (error || !data) throw new Error('Perubahan belum dikonfirmasi. Muat ulang data.')
}

export async function writeStockSettings(settings: StockSettings) {
  const { data, error } = await client().from('so_settings').update(settings).eq('id', 1)
    .select('id').abortSignal(AbortSignal.timeout(20_000)).single()
  if (error || !data) throw new Error('Aturan belum tersimpan. Periksa catatan dan coba lagi.')
}
