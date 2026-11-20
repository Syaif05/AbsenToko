import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { employeeStock, SessionEnded } from '../attendance/api'
import type { Account } from '../attendance/api'
import { displayDate } from '../attendance/dates'
import { groupStockItems, validQuantity } from './model'
import type { StockForm, StockReceipt, Values } from './model'
import { CopyStock, StockInput, StockSummary } from './StockFields'

export default function EmployeeStock({ account, onClose, onSessionEnded }: {
  account: Account; onClose: () => void; onSessionEnded: (message: string) => void
}) {
  const [form, setForm] = useState<StockForm>()
  const [receipt, setReceipt] = useState<StockReceipt>()
  const [values, setValues] = useState<Values>({})
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
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
  const filled = items.filter(item => (values[item.id] ?? []).some(value => value.trim())).length
  const invalid = new Set(items.filter(item =>
    !validQuantity(values[item.id] ?? ['', ''], item.unit_type === 'combined', !!form?.settings.require_all_fields)).map(item => item.id))
  const groups = groupStockItems(items.filter(item =>
    (item.name + ' ' + item.category_name).toLocaleLowerCase('id').includes(search.trim().toLocaleLowerCase('id'))),
  item => item.category_id)

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
  return <Dialog title={receipt ? 'Stock Opname tersimpan' : 'Stock Opname (SO)'} className="stock-dialog" busy={busy} onClose={onClose}>
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
            <details className="stock-guide" open>
              <summary>Panduan pengisian</summary>
              <p className="stock-lines">{form.settings.guidelines_text}</p>
            </details>
            {!items.length || items.length > 250 ? <Notice tone="warning">
              {!items.length ? 'Belum ada barang aktif. Hubungi Owner.' : 'Daftar melebihi 250 barang aktif. Minta Owner menonaktifkan barang yang tidak diperlukan.'}
            </Notice> : <>
              <label className="field">Cari barang<input type="search" value={search} placeholder="Contoh Gula atau Milky Series" onChange={e => setSearch(e.target.value)} /></label>
              <div className="stock-row"><strong>{filled}/{items.length} barang diisi</strong>
                <button className="button button-secondary" type="button" onClick={() => setValues(previous => {
                  const next = { ...previous }
                  for (const item of items) {
                    const [main, extra] = next[item.id] ?? ['', '']
                    next[item.id] = [main.trim() ? main : '-', item.unit_type === 'combined' ? (extra.trim() ? extra : '-') : '']
                  }
                  return next
                })}>Isi kolom kosong dengan −</button>
              </div>
              {!groups.length && <Notice>Tidak ada barang yang cocok.</Notice>}
              {groups.map(group => <details className="stock-group" key={group[0].category_id} open>
                <summary>{group[0].category_name} · {group.length}</summary>
                <div className="stack">{group.map(item => <StockInput key={item.id} item={item} value={values[item.id] ?? ['', '']}
                  invalid={attempted && invalid.has(item.id)}
                  presets={form.settings.quick_presets.filter(preset => item.unit_type !== 'combined' || !preset.includes('/'))}
                  onChange={value => setValues(previous => ({ ...previous, [item.id]: value }))} />)}</div>
              </details>)}
              <label className="field">Catatan (opsional)<textarea maxLength={500} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
              {attempted && invalid.size > 0 && <p className="stock-invalid" role="alert" ref={feedback} tabIndex={-1}>
                Periksa {invalid.size} isian. Isian pertama yang perlu diperiksa: {items.find(item => invalid.has(item.id))?.name}.
              </p>}
              {error && <Notice tone="error">{error}</Notice>}
              <button className="button button-primary" type="submit">{busy ? 'Menyimpan…' : 'Simpan Stock Opname'}</button>
            </>}
          </fieldset>
        </form>}
        {error && <>{!form && <Notice tone="error">{error}</Notice>}
          <button type="button" className="button button-secondary" onClick={reload} disabled={busy}>Muat ulang form</button></>}
      </>}
    </div>
  </Dialog>
}
