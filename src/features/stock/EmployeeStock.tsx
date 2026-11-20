import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { employeeStock, SessionEnded } from '../attendance/api'
import type { Account } from '../attendance/api'
import { displayDate } from '../attendance/dates'
import { validQuantity } from './model'
import type { StockForm, StockReceipt, Values } from './model'
import { CopyStock, CompactStockInput, StockSummary } from './StockFields'
import { searchStock } from './searchStock'

export default function EmployeeStock({ account, onClose, onSessionEnded }: {
  account: Account; onClose: () => void; onSessionEnded: (message: string) => void
}) {
  const [form, setForm] = useState<StockForm>()
  const [receipt, setReceipt] = useState<StockReceipt>()
  const [values, setValues] = useState<Values>({})
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showMore, setShowMore] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const request = useRef<{ id: string; key: string } | null>(null)
  const submitting = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const config = await employeeStock<StockForm>(account, 'stock_form')
        if (!active) return
        if (config.existing_id) {
          const saved = await employeeStock<StockReceipt>(account, 'stock_receipt', { id: config.existing_id })
          if (active) setReceipt(saved)
        } else {
          setForm(config)
          setValues(previous => Object.fromEntries(config.items
            .filter(item => previous[item.id] && validQuantity(previous[item.id], item.unit_type === 'combined', false))
            .map(item => [item.id, previous[item.id]])))
        }
      } catch (cause) {
        if (!active) return
        if (cause instanceof SessionEnded) onSessionEnded(cause.message)
        else setError(errorMessage(cause, 'Form stok belum bisa dimuat.'))
      }
    }
    void load()
    return () => { active = false }
  }, [account, onSessionEnded, revision])

  const items = form?.items ?? []
  const filled = items.filter(item => validQuantity(values[item.id] ?? ['', ''], item.unit_type === 'combined', true)).length
  const invalid = new Set(items.filter(item =>
    !validQuantity(values[item.id] ?? ['', ''], item.unit_type === 'combined', !!form?.settings.require_all_fields)).map(item => item.id))
  const categories = new Map(items.map(item => [item.category_id, item.category_name]))
  const activeCategory = categories.has(category) ? category : items[0]?.category_id
  const searching = !!search.trim()
  const matches = useMemo(() => searchStock(form?.items ?? [], search), [form, search])
  const shown = searching
    ? (matches.length ? (showMore ? matches : matches.slice(0, 8)) : items.filter(item => item.category_id === activeCategory).slice(0, 4))
    : items.filter(item => item.category_id === activeCategory)

  function fillEmpty() {
    setValues(previous => {
      const next = { ...previous }
      for (const item of items) {
        const [main, extra] = next[item.id] ?? ['', '']
        next[item.id] = [main.trim() || '-', item.unit_type === 'combined' ? extra.trim() || '-' : '']
      }
      return next
    })
  }

  function reload() {
    setForm(undefined)
    setError('')
    setRevision(previous => previous + 1)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form || submitting.current || !items.length || items.length > 250) return
    setAttempted(true)
    if (invalid.size) {
      setSearch('')
      setCategory(items.find(item => invalid.has(item.id))?.category_id ?? '')
      requestAnimationFrame(() => feedback.current?.focus())
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    const fields = { version: form.version, date: form.report_date, values, notes }
    const key = JSON.stringify(fields)
    if (key !== request.current?.key) request.current = { key, id: crypto.randomUUID() }
    try {
      setReceipt(await employeeStock<StockReceipt>(account, 'stock_save', { ...fields, id: request.current.id }))
    } catch (cause) {
      if (cause instanceof SessionEnded) onSessionEnded(cause.message)
      else setError(errorMessage(cause, 'Laporan belum dikonfirmasi. Coba lagi.'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const header = receipt?.report ?? form
  return <Dialog title={receipt ? 'Stock Opname tersimpan' : 'Stock Opname (SO)'} className={receipt ? "stock-dialog" : "stock-dialog stock-entry-dialog"} busy={busy} onClose={onClose}>
    <div className="stack">
      {header && <p><strong>{header.employee_name}</strong><br />{header.store_name} · {displayDate(header.report_date)} · WIB</p>}
      {receipt ? <>
        <Notice tone="success">Laporan stok sudah tercatat.</Notice>
        <CopyStock receipt={receipt} />
        <StockSummary receipt={receipt} />
      </> : <>
        {!form && !error && <Loading label="Memuat form SO…" />}
        {form && <form className="stack" onSubmit={save}>
          <fieldset className="stack stock-fieldset" disabled={busy}>
            {!items.length || items.length > 250 ? <Notice tone="warning">
              {!items.length ? 'Belum ada barang aktif. Hubungi Owner.' : 'Daftar melebihi 250 barang aktif. Minta Owner menonaktifkan barang yang tidak diperlukan.'}
            </Notice> : <>
              <div className="stock-entry-tools">
                <input type="search" aria-label="Cari barang" value={search} maxLength={80} autoComplete="off"
                  placeholder="Cari barang…" onChange={event => { setSearch(event.target.value); setShowMore(false) }}
                  onKeyDown={event => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    list.current?.querySelector('input')?.focus()
                  }} />
                {!searching && <select aria-label="Kategori barang" value={activeCategory}
                  onChange={event => setCategory(event.target.value)}>
                  {[...categories].map(([id, name]) => <option value={id} key={id}>{name}</option>)}
                </select>}
                {searching && <p className="muted stock-search-result" role="status">
                  {matches.length ? matches.length + ' barang ditemukan' : 'Tidak ada kecocokan. Coba pilihan berikut.'}
                </p>}
              </div>
              <div className="stock-compact-list" ref={list}>
                {shown.map(item => <CompactStockInput key={item.id} item={item} value={values[item.id] ?? ['', '']}
                  invalid={attempted && invalid.has(item.id)}
                  onChange={value => setValues(previous => ({ ...previous, [item.id]: value }))} />)}
              </div>
              {searching && matches.length > 8 && !showMore && <button type="button" className="button button-quiet"
                onClick={() => setShowMore(true)}>Lihat semua {matches.length} hasil</button>}
              <details className="stock-notes">
                <summary>Catatan opsional</summary>
                <textarea aria-label="Catatan" maxLength={500} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </details>
              {attempted && invalid.size > 0 && <p className="stock-invalid stock-feedback" role="alert" ref={feedback} tabIndex={-1}>
                Periksa {invalid.size} isian. Mulai dari {items.find(item => invalid.has(item.id))?.name}.
              </p>}
              {error && <Notice tone="error">{error}</Notice>}
              <div className="stock-entry-footer">
                <div className="stock-row">
                  <span>{filled}/{items.length} terisi</span>
                  {filled < items.length && <button className="button button-quiet" type="button" onClick={fillEmpty}>Isi yang kosong dengan −</button>}
                </div>
                <button className="button button-primary" type="submit">{busy ? 'Menyimpan…' : 'Simpan Stock Opname'}</button>
              </div>
            </>}
          </fieldset>
        </form>}
        {error && <>{!form && <Notice tone="error">{error}</Notice>}
          <button type="button" className="button button-secondary" onClick={reload} disabled={busy}>Muat ulang form</button></>}
      </>}
    </div>
  </Dialog>
}
