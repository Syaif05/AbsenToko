import { ownerClient } from '../owner/api'
import type { Category, MasterItem, ReportItem, StockReceipt, StockReport, StockSettings } from './model'

function client() {
  if (!ownerClient) throw new Error('Konfigurasi Owner belum tersedia.')
  return ownerClient
}

export type StockFilters = { start: string; end: string; name: string }
export const stockPageSize = 25
const header = 'id,employee_name,store_name,report_date,created_at,updated_at,notes,guidelines_snapshot'
const lines = 'so_report_items(id,report_id,item_name_snapshot,category_id_snapshot,category_name_snapshot,unit_snapshot,unit_type_snapshot,raw_value,secondary_value,status_flag,sort_order)'

function reportsQuery(columns: string, { start, end, name }: StockFilters) {
  let query = client().from('so_reports').select(columns)
    .order('report_date', { ascending: false }).order('created_at', { ascending: false }).order('id')
  if (start) query = query.gte('report_date', start)
  if (end) query = query.lte('report_date', end)
  if (name.trim()) query = query.ilike('employee_name', '%' + name.trim().replace(/[%_\\*]/g, '\\$&') + '%')
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

export async function stockMaster(signal: AbortSignal) {
  const db = client()
  const readCatalog = async <T>(table: string) => {
    const rows: T[] = []
    for (let from = 0; ; from += 500) {
      const { data, error } = await db.from(table).select('*').order('sort_order').order('name').order('id')
        .range(from, from + 499).abortSignal(signal).returns<T[]>()
      if (error) throw new Error('Pengaturan Stock Opname gagal dimuat.')
      rows.push(...data)
      if (data.length < 500) return rows
    }
  }
  const [categories, items, settings] = await Promise.all([
    readCatalog<Category>('so_categories'),
    readCatalog<MasterItem>('so_items'),
    db.from('so_settings').select('guidelines_text,quick_presets,require_all_fields')
      .eq('id', 1).abortSignal(signal).returns<StockSettings[]>().single(),
  ])
  if (settings.error) throw new Error('Pengaturan Stock Opname gagal dimuat.')
  return { categories, items, settings: settings.data }
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
  if (error || !data) throw new Error('Aturan belum tersimpan. Periksa panduan dan isian cepat.')
}
