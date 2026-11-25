import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { displayDate, displayTime, todayWib } from '../attendance/dates'
import { setStockOnHand } from '../owner/api'
import { displayStockQuantity, validQuantity } from './model'
import type { Quantity, StockItem } from './model'
import { OnHandUnavailable, onHandDirectory, onHandStore } from './ownerStock'
import type { OnHand } from './ownerStock'
import { searchStock } from './searchStock'
import './stock.css'

type StoreStock = Awaited<ReturnType<typeof onHandStore>>

function quantityLabel(value: OnHand['quantity'] | null, label: string) {
  return displayStockQuantity({
    raw_value: value?.[0] ?? null, secondary_value: value?.[1] ?? null,
    unit_snapshot: label, unit_type_snapshot: value?.[1] != null ? 'combined' : 'single',
  })
}

function unitsMatch(item: StockItem, balance: OnHand) {
  return item.unit_type === balance.unit_type && item.unit_label === balance.unit_label
}

function updatedLabel(instant: string) {
  return displayDate(todayWib(new Date(instant))) + ' · ' + displayTime(instant) + ' WIB'
}

function isEmpty(quantity: OnHand['quantity']) {
  return quantity.every(value => value == null || /^(?:-|0[0.]*(?:\/[1-9][0-9]*)?)$/.test(value))
}

export default function StockOnHand() {
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof onHandDirectory>>>()
  const [storeId, setStoreId] = useState('')
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void onHandDirectory(controller.signal).then(result => {
      if (!controller.signal.aborted) setDirectory(result)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(errorMessage(cause, 'Daftar toko dan barang belum tersedia.'))
    })
    return () => controller.abort()
  }, [retry])

  const store = directory?.stores.find(entry => entry.id === storeId) ?? directory?.stores[0]
  return <section className="stack" aria-label="Stock on hand">
    <header className="soh-heading">
      <div className="stack">
        <p className="panel-kicker">Persediaan toko</p>
        <h2>Stock on hand (SOH)</h2>
        <p className="muted">Tetapkan stok awal atau perbarui jumlah setelah restok. Hasil SO karyawan menjadi stok untuk SO berikutnya.</p>
      </div>
      {store && <label>Toko
        <select value={store.id} onChange={event => setStoreId(event.target.value)}>
          {directory?.stores.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>}
    </header>
    {error && <Notice tone="error">{error}<br />
      <button type="button" className="button button-secondary" onClick={() => { setError(''); setRetry(value => value + 1) }}>Muat ulang</button>
    </Notice>}
    {!directory && !error && <Loading label="Memuat toko dan barang…" />}
    {directory && !store && <Notice>Tambahkan toko aktif untuk mengatur stok.</Notice>}
    {directory && store && <StockForStore key={store.id} storeId={store.id} items={directory.items} />}
  </section>
}

function StockForStore({ storeId, items }: { storeId: string; items: StockItem[] }) {
  const [result, setResult] = useState<StoreStock>()
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<StockItem>()
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void onHandStore(storeId, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }).catch(cause => {
      if (controller.signal.aborted) return
      if (cause instanceof OnHandUnavailable) setUnavailable(true)
      else setError(errorMessage(cause, 'Stok belum bisa dimuat.'))
    })
    return () => controller.abort()
  }, [storeId, revision])

  function reload() {
    setResult(undefined)
    setUnavailable(false)
    setError('')
    setRevision(value => value + 1)
  }

  const balances = useMemo(() => new Map(result?.stock.map(row => [row.item_id, row])), [result])
  const matching = useMemo(() => search.trim() ? searchStock(items, search) : items, [items, search])
  const configured = items.filter(item => {
    const balance = balances.get(item.id)
    return balance && unitsMatch(item, balance)
  })
  const empty = configured.filter(item => isEmpty(balances.get(item.id)!.quantity))
  const shown = filter === 'setup' ? matching.filter(item => !configured.includes(item)) :
    filter === 'empty' ? matching.filter(item => empty.includes(item)) : matching

  if (unavailable) return <section className="soh-panel stack">
    <Notice tone="warning">Stock on hand belum aktif. Setelah pembaruan layanan, muat ulang untuk mengatur stok awal.</Notice>
    <div><button type="button" className="button button-secondary" onClick={reload}>Muat ulang</button></div>
  </section>
  if (error) return <div className="stack">
    {notice && <Notice tone="success">{notice}</Notice>}
    <Notice tone="error">{error}</Notice>
    <button type="button" className="button button-secondary" onClick={reload}>Muat ulang</button>
  </div>
  if (!result) return <Loading label="Memuat saldo dan riwayat stok…" />

  return <div className="stack">
    {notice && <Notice tone="success">{notice}</Notice>}
    <div className="soh-stats">
      <div><span>Stok disetel</span><strong>{configured.length}</strong></div>
      <div><span>Perlu disetel</span><strong>{items.length - configured.length}</strong></div>
      <div><span>Stok habis</span><strong>{empty.length}</strong></div>
    </div>
    <section className="soh-panel stack" aria-label="Daftar stok">
      <div className="soh-tools">
        <label>Cari barang<input type="search" placeholder="Nama barang atau kategori" value={search}
          maxLength={80} onChange={event => setSearch(event.target.value)} /></label>
        <label>Tampilkan
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">Semua barang</option>
            <option value="setup">Perlu disetel</option>
            <option value="empty">Stok habis</option>
          </select>
        </label>
        <button type="button" className="button button-secondary" onClick={reload}>Muat ulang</button>
      </div>
      {!shown.length && <Notice>{items.length ? 'Tidak ada barang yang cocok.' : 'Aktifkan barang di Pengaturan SO untuk mulai.'}</Notice>}
      {shown.length > 0 && <ul className="soh-list">
        {shown.map(item => {
          const balance = balances.get(item.id)
          const needsSetup = !balance || !unitsMatch(item, balance)
          return <li key={item.id} className="soh-item">
            <div><strong>{item.name}</strong><small>{item.category_name} · {item.unit_label}</small></div>
            <div className="soh-amount">
              {needsSetup ? <span className="stock-badge stock-low">{balance ? 'Satuan berubah' : 'Belum disetel'}</span> : <>
                <strong>{quantityLabel(balance.quantity, balance.unit_label)}</strong>
                {balance.units_per_box && <small>{balance.units_per_box} pcs per kardus</small>}
                <small>{updatedLabel(balance.updated_at)}</small>
              </>}
            </div>
            <button type="button" className="button button-secondary" onClick={() => { setEditing(item); setNotice('') }}
              aria-label={(needsSetup ? 'Atur stok ' : 'Ubah stok ') + item.name}>{needsSetup ? 'Atur stok' : 'Ubah stok'}</button>
          </li>
        })}
      </ul>}
    </section>
    <details className="soh-panel soh-history">
      <summary>Riwayat perubahan · 20 terakhir</summary>
      {!result.history.length ? <p className="muted">Belum ada perubahan stok.</p> : <ul className="soh-list">
        {result.history.map(entry => <li key={entry.id} className="soh-item soh-history-item">
          <div><strong>{entry.item_name}</strong>
            <small>{entry.actor_name} · {entry.report_id ? 'Dari SO' : 'Setelan stok'}</small>
            {entry.note && <small>{entry.note}</small>}
          </div>
          <div><strong>{quantityLabel(entry.before_quantity, entry.before_unit_label ?? entry.unit_label)} → {quantityLabel(entry.quantity, entry.unit_label)}</strong>
            <small>{updatedLabel(entry.recorded_at)}</small></div>
        </li>)}
      </ul>}
    </details>
    {editing && <EditBalance item={editing} balance={balances.get(editing.id)} storeId={storeId}
      onClose={() => setEditing(undefined)} onSaved={() => {
        setNotice('Stok ' + editing.name + ' tersimpan.')
        setEditing(undefined)
        reload()
      }} />}
  </div>
}

function EditBalance({ item, balance, storeId, onClose, onSaved }: {
  item: StockItem; balance?: OnHand; storeId: string; onClose: () => void; onSaved: () => void
}) {
  const original = balance && unitsMatch(item, balance) ? balance : undefined
  const [quantity, setQuantity] = useState<Quantity>([original?.quantity[0] ?? '', original?.quantity[1] ?? ''])
  const [pack, setPack] = useState(original?.units_per_box?.toString() ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const combined = item.unit_type === 'combined'

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    if (!validQuantity(quantity, combined, true) || (combined && (!/^\d{1,6}$/.test(pack) || Number(pack) < 1))) {
      setError(combined ? 'Isi jumlah kardus, pcs lepas, dan isi per kardus dengan bilangan bulat.' : 'Isi angka, pecahan seperti 1/2, atau tanda - untuk stok kosong.')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await setStockOnHand(item.id, { store_id: storeId, values: [quantity[0].trim(), quantity[1].trim()],
        units_per_box: combined ? Number(pack) : null, version: balance?.updated_at ?? null, note: note.trim() })
      onSaved()
    } catch (cause) {
      setError(errorMessage(cause, 'Stok belum bisa disimpan.'))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <Dialog title={item.name} onClose={onClose} busy={busy} className="stock-dialog">
    <form className="stack" onSubmit={save}>
      {error && <Notice tone="error">{error}</Notice>}
      <fieldset className="stock-fieldset stack" disabled={busy}>
        <p className="muted">Masukkan jumlah stok akhir setelah penyesuaian. Jumlah ini menjadi batas untuk hitungan berikutnya.</p>
        <div className="stock-filter">
          <label>{combined ? 'Jumlah kardus' : 'Jumlah stok · ' + item.unit_label}
            <input value={quantity[0]} maxLength={24} required autoComplete="off"
              placeholder={combined ? '0' : '0, 30, atau 1/2'} inputMode={combined ? 'numeric' : undefined}
              onChange={event => setQuantity([event.target.value, quantity[1]])} />
          </label>
          {combined && <>
            <label>Jumlah pcs lepas<input inputMode="numeric" value={quantity[1]} maxLength={24} required placeholder="0"
              onChange={event => setQuantity([quantity[0], event.target.value])} /></label>
            <label>Isi per kardus (pcs)<input inputMode="numeric" value={pack} maxLength={6} required placeholder="Contoh 12"
              onChange={event => setPack(event.target.value)} /></label>
          </>}
        </div>
        <label>Catatan (opsional)<input maxLength={160} value={note} placeholder="Contoh Restok dari pemasok"
          onChange={event => setNote(event.target.value)} /></label>
        <div className="stock-actions">
          <button type="submit" className="button button-primary">{busy ? 'Menyimpan…' : 'Simpan stok'}</button>
          <button type="button" className="button button-secondary" onClick={onClose}>Batal</button>
        </div>
      </fieldset>
    </form>
  </Dialog>
}
