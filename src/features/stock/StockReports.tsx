import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { displayDate, todayWib } from '../attendance/dates'
import { changeStockReport } from '../owner/api'
import { CopyStock, StockInput, StockSummary, StockToast } from './StockFields'
import { groupStockItems, validQuantity } from './model'
import type { StockReceipt, Values } from './model'
import { stockDetail, stockReports } from './ownerStock'
import type { StockFilters } from './ownerStock'

const initialFilters = () => ({ start: todayWib(), end: todayWib(), name: '' })

export default function StockReports() {
  const [draft, setDraft] = useState<StockFilters>(initialFilters)
  const [filters, setFilters] = useState<StockFilters>(initialFilters)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Awaited<ReturnType<typeof stockReports>>>()
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState<{ text: string; ok: boolean }>()
  const [loadError, setLoadError] = useState('')
  const [exporting, setExporting] = useState(false)
  const exportLock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
    void stockReports(filters, page, signal).then(
      result => { if (!controller.signal.aborted) setData(result) },
      cause => { if (!controller.signal.aborted) setLoadError(errorMessage(cause, 'Daftar laporan belum bisa dimuat.')) },
    )
    return () => controller.abort()
  }, [filters, page, revision])

  function load(next: StockFilters, nextPage = 0) {
    setData(undefined)
    setLoadError('')
    setPage(nextPage)
    setFilters({ ...next })
  }

  async function download(format: 'xlsx' | 'csv') {
    if (exportLock.current) return
    exportLock.current = true
    setExporting(true)
    setNotice(undefined)
    try {
      const { exportStock } = await import('./exportStock')
      await exportStock(format, filters)
      setNotice({ text: 'File ekspor siap diunduh.', ok: true })
    } catch (cause) {
      setNotice({ text: errorMessage(cause, 'Ekspor gagal.'), ok: false })
    } finally {
      exportLock.current = false
      setExporting(false)
    }
  }

  return <section className="panel stack">
    <h2>Laporan SO</h2>
    <form className="stack" onSubmit={event => { event.preventDefault(); setNotice(undefined); load(draft) }}>
      <div className="stock-filter">
        <label className="field">Mulai tanggal<input type="date" value={draft.start} max={draft.end || undefined}
          onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
        <label className="field">Sampai tanggal<input type="date" value={draft.end} min={draft.start || undefined}
          onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
        <label className="field">Nama pengisi<input type="search" maxLength={120} value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      </div>
      <div className="stock-actions">
        <button className="button button-primary" type="submit">Terapkan filter</button>
        <button className="button button-quiet" type="button" onClick={() => {
          const all = { start: '', end: '', name: '' }
          setDraft(all)
          load(all)
        }}>Semua tanggal</button>
      </div>
    </form>
    <div className="stock-actions" aria-label="Ekspor hasil filter">
      <button className="button button-secondary" disabled={exporting || !data?.rows.length}
        onClick={() => void download('xlsx')}>Unduh Excel</button>
      <button className="button button-secondary" disabled={exporting || !data?.rows.length}
        onClick={() => void download('csv')}>Unduh CSV</button>
      {exporting && <Loading label="Menyiapkan ekspor…" />}
    </div>
    {notice && (notice.ok ? <StockToast key={notice.text} message={notice.text} /> : <Notice tone="error">{notice.text}</Notice>)}
    {loadError ? <><Notice tone="error">{loadError}</Notice>
      <button className="button button-secondary" onClick={() => { setLoadError(''); setRevision(value => value + 1) }}>Muat ulang</button></>
    : !data ? <Loading label="Memuat laporan…" /> : !data.rows.length ? <Notice>Belum ada laporan untuk filter ini.</Notice>
    : <div className="stock-list">{data.rows.map(row => <button className="button button-secondary stock-report-link" key={row.id} onClick={() => setSelected(row.id)}>
      <strong>{row.employee_name}</strong><span>{displayDate(row.report_date)} · {row.store_name}</span>
    </button>)}</div>}
    {(page > 0 || data?.more) && <div className="stock-actions">
      <button className="button button-secondary" disabled={page === 0 || !data} onClick={() => load(filters, page - 1)}>Sebelumnya</button>
      <span>Halaman {page + 1}</span>
      <button className="button button-secondary" disabled={!data?.more} onClick={() => load(filters, page + 1)}>Berikutnya</button>
    </div>}
    {selected && <ReportDialog id={selected} key={selected} onClose={() => setSelected('')} onSaved={message => {
      setSelected('')
      setNotice({ text: message, ok: true })
      load(filters)
    }} />}
  </section>
}

function ReportDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [receipt, setReceipt] = useState<StockReceipt>()
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [values, setValues] = useState<Values>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    let active = true
    void stockDetail(id).then(result => {
      if (!active) return
      setReceipt(result)
      setNotes(result.report.notes)
      setValues(Object.fromEntries(result.items.map(item => [item.id, [item.raw_value ?? '', item.secondary_value ?? '']])))
    }, cause => { if (active) setError(errorMessage(cause, 'Detail laporan belum bisa dimuat.')) })
    return () => { active = false }
  }, [id, revision])

  async function save(deleting: boolean) {
    if (!receipt || lock.current) return
    const invalid = !deleting && receipt.items.find(item => !validQuantity(values[item.id], item.unit_type_snapshot === 'combined', false))
    if (invalid) {
      setError('Periksa jumlah untuk ' + invalid.item_name_snapshot + '.')
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await changeStockReport(id, receipt.report.updated_at, deleting ? undefined : { values, notes })
      onSaved(deleting ? 'Laporan sudah dihapus.' : 'Perubahan laporan tersimpan.')
    } catch (cause) {
      setError(errorMessage(cause, 'Perubahan belum dikonfirmasi.'))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <Dialog title="Detail laporan SO" className="stock-dialog" busy={busy} onClose={onClose}>
    <div className="stack">
      {!receipt && !error && <Loading label="Memuat detail…" />}
      {receipt && <>
        <p><strong>{receipt.report.employee_name}</strong><br />{displayDate(receipt.report.report_date)} · {receipt.report.store_name}</p>
        {mode === 'view' && <>
          <div className="stock-actions">
            <button className="button button-secondary" onClick={() => setMode('edit')}>Edit laporan</button>
            <button className="button button-quiet" onClick={() => setMode('delete')}>Hapus laporan</button>
          </div>
          <CopyStock receipt={receipt} />
          <StockSummary receipt={receipt} />
        </>}
        {mode === 'delete' && <>
          <Notice tone="warning">Hapus laporan ini beserta seluruh isian stoknya?</Notice>
          <div className="stock-actions">
            <button className="button button-secondary" disabled={busy} onClick={() => { setMode('view'); setError('') }}>Batal</button>
            <button className="button button-primary" disabled={busy} onClick={() => void save(true)}>{busy ? 'Menghapus…' : 'Ya, hapus laporan'}</button>
          </div>
        </>}
        {mode === 'edit' && <form onSubmit={event => { event.preventDefault(); void save(false) }}>
          <fieldset className="stack stock-fieldset" disabled={busy}>
            {groupStockItems(receipt.items, item => item.category_id_snapshot).map(group =>
              <details className="stock-group" key={group[0].category_id_snapshot} open>
                <summary>{group[0].category_name_snapshot}</summary>
                <div className="stack">{group.map(item => <StockInput key={item.id}
                  item={{ name: item.item_name_snapshot, unit_label: item.unit_snapshot, unit_type: item.unit_type_snapshot }}
                  value={values[item.id]} onChange={value => setValues(previous => ({ ...previous, [item.id]: value }))} />)}</div>
              </details>)}
            <label className="field">Catatan<textarea rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <button className="button button-primary" type="submit">{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
          </fieldset>
        </form>}
      </>}
      {error && <>
        <Notice tone="error">{error}</Notice>
        <button className="button button-secondary" disabled={busy} onClick={() => {
          setMode('view')
          setReceipt(undefined)
          setError('')
          setRevision(value => value + 1)
        }}>Muat ulang detail</button>
      </>}
    </div>
  </Dialog>
}
