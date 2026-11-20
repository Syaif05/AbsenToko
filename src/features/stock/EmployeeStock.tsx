import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { employeeStock, SessionEnded, StockConflict } from '../attendance/api'
import type { Account } from '../attendance/api'
import { displayDate } from '../attendance/dates'
import { validQuantity } from './model'
import type { Quantity, SharedStockItem, StockForm } from './model'
import { CompactStockInput, CopyStock } from './StockFields'
import { searchStock } from './searchStock'

type Edit = { values: Quantity; revision: number }
type Draft = { changes: Record<string, Edit>; notes: string; reportId: string | null }
const emptyDraft = (reportId: string | null = null): Draft => ({ changes: {}, notes: '', reportId })
const savedValues = (item: SharedStockItem): Quantity => [item.values?.[0] ?? '', item.values?.[1] ?? '']
const sameQuantity = (a: Quantity, b: Quantity) => a[0].trim() === b[0].trim() && a[1].trim() === b[1].trim()

function draftKey(account: Account, form: StockForm) {
  return `teh-idaman:so:${import.meta.env.VITE_SUPABASE_URL}:${account.employee.id}:${form.report_date}:${form.version}`
}

function loadDraft(key: string, form: StockForm): Draft {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null
    if (!stored) return emptyDraft(form.report_id)
    const changes: Draft['changes'] = {}
    for (const item of form.items) {
      const edit = stored.changes?.[item.id]
      if (!edit || !Array.isArray(edit.values) || edit.values.length !== 2
        || !edit.values.every(value => typeof value === 'string' && value.length <= 24)
        || !Number.isInteger(edit.revision) || sameQuantity(edit.values, savedValues(item))) continue
      changes[item.id] = { ...edit, revision: stored.reportId && stored.reportId !== form.report_id ? -1 : edit.revision }
    }
    return { changes, notes: typeof stored.notes === 'string' ? stored.notes.slice(0, 500) : '', reportId: form.report_id }
  } catch {
    return emptyDraft(form.report_id)
  }
}

export default function EmployeeStock({ account, onClose, onSessionEnded }: {
  account: Account; onClose: () => void; onSessionEnded: (message: string) => void
}) {
  const [form, setForm] = useState<StockForm>()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const request = useRef<{ id: string; key: string } | null>(null)
  const submitting = useRef(false)
  const draftRef = useRef<{ key: string; draft: Draft } | null>(null)

  useEffect(() => {
    let active = true
    void employeeStock<StockForm>(account, 'stock_shared_form').then(next => {
      if (!active) return
      const key = draftKey(account, next)
      const previous = draftRef.current
      const stored = loadDraft(key, next)
      if (previous?.key === key) {
        for (const item of next.items) {
          const edit = previous.draft.changes[item.id]
          if (!edit || sameQuantity(edit.values, savedValues(item))) continue
          stored.changes[item.id] = { ...edit, revision: previous.draft.reportId && previous.draft.reportId !== next.report_id ? -1 : edit.revision }
        }
        stored.notes = previous.draft.notes
      } else if (previous && Object.keys(previous.draft.changes).length) {
        setMessage('Tanggal atau daftar barang berubah. Periksa isian untuk SO yang sekarang.')
      }
      draftRef.current = { key, draft: stored }
      setDraft(stored)
      setForm(next)
    }, cause => {
      if (!active) return
      if (cause instanceof SessionEnded) onSessionEnded(cause.message)
      else setError(errorMessage(cause, 'Form stok belum bisa dimuat.'))
    }).finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
  }, [account, onSessionEnded, revision])

  const items = form?.items ?? []
  const changes = draft.changes
  const changeCount = Object.keys(changes).length
  const savedCount = items.filter(item => item.values?.[0] != null).length
  const conflicts = items.filter(item => changes[item.id] && changes[item.id].revision !== (item.revision ?? 0))
  const invalid = items.filter(item => changes[item.id] && !validQuantity(changes[item.id].values, item.unit_type === 'combined', false))
  const categories = new Map(items.map(item => [item.category_id, item.category_name]))
  const activeCategory = categories.has(category) ? category : items[0]?.category_id
  const searching = !!search.trim()
  const matches = useMemo(() => searchStock(form?.items ?? [], search), [form, search])
  const categoryItems = items.filter(item => item.category_id === activeCategory)
  const shown = searching ? (matches.length ? (showMore ? matches : matches.slice(0, 8)) : categoryItems.slice(0, 4)) : categoryItems

  function updateDraft(next: Draft, current = form) {
    if (!current) return
    const key = draftKey(account, current)
    draftRef.current = { key, draft: next }
    setDraft(next)
    try {
      if (Object.keys(next.changes).length || next.notes) localStorage.setItem(key, JSON.stringify(next))
      else localStorage.removeItem(key)
      setStorageUnavailable(false)
    } catch {
      setStorageUnavailable(true)
    }
  }

  function change(item: SharedStockItem, values: Quantity, acceptLatestRevision = false) {
    const next = { ...changes }
    if (sameQuantity(values, savedValues(item))) delete next[item.id]
    else next[item.id] = { values, revision: acceptLatestRevision ? (item.revision ?? 0) : (next[item.id]?.revision ?? item.revision ?? 0) }
    updateDraft({ ...draft, changes: next })
    setMessage('')
  }

  function reload() {
    setRefreshing(true)
    setError('')
    setRevision(previous => previous + 1)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form || submitting.current || refreshing || !changeCount || conflicts.length || !items.length || items.length > 250) return
    setAttempted(true)
    if (invalid.length) {
      setSearch('')
      setCategory(invalid[0].category_id)
      requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    setMessage('')
    const normalized = Object.fromEntries(Object.entries(changes).map(([id, edit]) => [id, {
      revision: edit.revision, values: edit.values.map(value => value.trim()),
    }]))
    const fields = { report_id: form.report_id, version: form.version, date: form.report_date, changes: normalized, notes: draft.notes }
    const key = JSON.stringify(fields)
    if (key !== request.current?.key) request.current = { key, id: crypto.randomUUID() }
    try {
      const next = await employeeStock<StockForm>(account, 'stock_shared_save', { ...fields, id: request.current.id })
      setForm(next)
      updateDraft(emptyDraft(next.report_id), next)
      setAttempted(false)
      setMessage('Perubahan tersimpan. Tim bisa melanjutkan SO ini.')
    } catch (cause) {
      if (cause instanceof SessionEnded) onSessionEnded(cause.message)
      else if (cause instanceof StockConflict) {
        reload()
        setMessage('Ada pembaruan dari tim. Periksa isian sebelum menyimpan kembali.')
      } else setError(errorMessage(cause, 'Hasil penyimpanan belum dikonfirmasi. Coba lagi.'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function close() {
    if (storageUnavailable && (changeCount || draft.notes) && !window.confirm('Draf tidak dapat disimpan di perangkat ini. Tutup SO?')) return
    onClose()
  }

  return <Dialog title="Stock Opname (SO)" className="stock-dialog stock-entry-dialog" busy={busy} onClose={close}>
    <div className="stack">
      {form && <div className="stock-entry-context">
        <div><strong>{form.store_name}</strong><br /><small>{displayDate(form.report_date)} · WIB</small></div>
        <span className="stock-badge">SO bersama</span>
      </div>}
      {message && <Notice>{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!form && refreshing && <Loading label="Memuat SO toko…" />}
      {!form && error && <button type="button" className="button button-secondary" onClick={reload}>Muat ulang</button>}
      {form && <form className="stack" onSubmit={save}>
        <fieldset className="stack stock-fieldset" disabled={busy || refreshing}>
          <div className="stock-row">
            <small className="muted">Mengisi sebagai {form.employee_name}</small>
            <button type="button" className="button button-quiet" onClick={reload}>{refreshing ? 'Memuat…' : 'Muat ulang SO'}</button>
          </div>
          {conflicts.length > 0 && <section className="stack stock-conflicts" aria-label="Isian yang perlu diperiksa">
            <Notice tone="warning">{conflicts.length} barang berubah sejak terakhir dibuka. Pilih isian yang akan dipakai.</Notice>
            {conflicts.map(item => <div key={item.id} className="stack">
              <strong>{item.name}</strong>
              <small>Tersimpan: {savedValues(item).filter(Boolean).join(' + ') || 'Belum diisi'} · Draf: {changes[item.id].values.filter(Boolean).join(' + ') || 'Kosong'}</small>
              <div className="stock-actions">
                <button type="button" className="button button-secondary" onClick={() => change(item, savedValues(item))}>Pakai isian tim</button>
                <button type="button" className="button button-quiet" onClick={() => change(item, changes[item.id].values, true)}>Pertahankan draf</button>
              </div>
            </div>)}
          </section>}
          {!items.length || items.length > 250 ? <Notice tone="warning">Daftar barang belum siap. Hubungi Owner.</Notice> : <>
            <div className="stock-entry-tools">
              <input type="search" aria-label="Cari barang" value={search} maxLength={80} autoComplete="off"
                placeholder="Cari barang…" onChange={event => { setSearch(event.target.value); setShowMore(false) }}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  list.current?.querySelector('input')?.focus()
                }} />
              {!searching && <select aria-label="Kategori barang" value={activeCategory} onChange={event => setCategory(event.target.value)}>
                {[...categories].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
              </select>}
              {searching && <p className="muted stock-search-result" role="status">
                {matches.length ? matches.length + ' barang ditemukan' : 'Tidak ada kecocokan. Berikut pilihan dari kategori aktif.'}
              </p>}
            </div>
            <div className="stock-compact-list" ref={list}>
              {shown.map(item => <CompactStockInput key={item.id} item={item} value={changes[item.id]?.values ?? savedValues(item)}
                invalid={attempted && invalid.includes(item)} credit={item.last_editor} onChange={value => change(item, value)} />)}
            </div>
            {searching && matches.length > 8 && !showMore && <button type="button" className="button button-quiet"
              onClick={() => setShowMore(true)}>Lihat semua {matches.length} hasil</button>}
            <details className="stock-notes">
              <summary>Catatan perubahan</summary>
              <textarea aria-label="Catatan perubahan" maxLength={500} rows={2} value={draft.notes}
                onChange={event => updateDraft({ ...draft, notes: event.target.value })} />
            </details>
            {form.report_id && !changeCount && <CopyStock stock={{ names: form.contributors,
              report: { store_name: form.store_name, report_date: form.report_date, notes: '', guidelines_snapshot: form.guidelines },
              items: items.map(item => ({ category_id_snapshot: item.category_id, category_name_snapshot: item.category_name,
                item_name_snapshot: item.name, raw_value: item.values?.[0] ?? null, secondary_value: item.values?.[1] ?? null,
                unit_snapshot: item.unit_label, unit_type_snapshot: item.unit_type })),
            }} />}
            <div className="stock-entry-footer">
              <div className="stock-row">
                <span>{savedCount}/{items.length} tersimpan</span>
                {changeCount > 0 && <span>{changeCount} perubahan{storageUnavailable ? '' : ' · draf lokal'}</span>}
              </div>
              <progress className="stock-progress" value={savedCount} max={items.length} aria-label="Progres isian tersimpan" />
              {storageUnavailable && <small role="status">Draf tidak dapat disimpan di perangkat.</small>}
              <button className="button button-primary" type="submit" disabled={!changeCount || conflicts.length > 0}>
                {busy ? 'Menyimpan…' : 'Simpan perubahan'}
              </button>
            </div>
          </>}
        </fieldset>
      </form>}
    </div>
  </Dialog>
}
