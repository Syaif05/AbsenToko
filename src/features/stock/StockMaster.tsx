import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { StockToast } from './StockFields'
import { validStockValue } from './model'
import type { Category, MasterItem, StockSettings } from './model'
import { stockMaster, writeStockMaster, writeStockSettings } from './ownerStock'

type Editor = { table: 'so_categories'; row?: Category } | { table: 'so_items'; row?: MasterItem }

export default function StockMaster() {
  const [data, setData] = useState<Awaited<ReturnType<typeof stockMaster>>>()
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<Editor>()

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
    void stockMaster(signal).then(
      result => { if (!controller.signal.aborted) setData(result) },
      cause => { if (!controller.signal.aborted) setError(errorMessage(cause, 'Pengaturan gagal dimuat.')) },
    )
    return () => controller.abort()
  }, [revision])

  function reload() {
    setData(undefined)
    setError('')
    setRevision(value => value + 1)
  }

  return <div className="stack">
    {message && <StockToast key={revision} message={message} />}
    {error ? <section className="panel stack"><Notice tone="error">{error}</Notice>
      <button className="button button-secondary" onClick={reload}>Muat ulang</button></section>
    : !data ? <Loading label="Memuat pengaturan SO…" /> : <>
      <SettingsForm settings={data.settings} onSaved={setMessage} />
      <section className="panel stack">
        <div className="stock-row">
          <h2>Kategori dan barang</h2>
          <div className="stock-actions">
            <button className="button button-secondary" onClick={() => setEditor({ table: 'so_categories' })}>Tambah kategori</button>
            <button className="button button-primary" disabled={!data.categories.length}
              onClick={() => setEditor({ table: 'so_items' })}>Tambah barang</button>
          </div>
        </div>
        {!data.categories.length && <Notice>Belum ada kategori. Tambahkan kategori untuk mulai mengatur barang.</Notice>}
        {data.categories.map(category => <details className="stock-group" key={category.id}>
          <summary>{category.name} · {category.is_active ? 'Aktif' : 'Nonaktif'}</summary>
          <div className="stack">
            <button className="button button-secondary" onClick={() => setEditor({ table: 'so_categories', row: category })}>Edit kategori</button>
            {data.items.filter(item => item.category_id === category.id).map(item =>
              <div className="stock-row stock-result" key={item.id}>
                <div><strong>{item.name}</strong><p>{item.unit_label} · {item.is_active ? 'Aktif' : 'Nonaktif'} · Urutan {item.sort_order}</p></div>
                <button className="button button-secondary" aria-label={'Edit ' + item.name}
                  onClick={() => setEditor({ table: 'so_items', row: item })}>Edit</button>
              </div>)}
          </div>
        </details>)}
      </section>
      {editor && <MasterDialog editor={editor} categories={data.categories} onClose={() => setEditor(undefined)}
        onSaved={text => { setEditor(undefined); setMessage(text); reload() }} />}
    </>}
  </div>
}

function SettingsForm({ settings, onSaved }: { settings: StockSettings; onSaved: (message: string) => void }) {
  const [guidelines, setGuidelines] = useState(settings.guidelines_text)
  const [presets, setPresets] = useState(settings.quick_presets.join(', '))
  const [required, setRequired] = useState(settings.require_all_fields)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean }>()
  const lock = useRef(false)

  return <form className="panel stack" onSubmit={async event => {
    event.preventDefault()
    if (lock.current) return
    const quick = presets.trim() ? [...new Set(presets.split(',').map(value => value.trim()))] : []
    if (!guidelines.trim() || quick.length > 12 || quick.some(value => !validStockValue(value))) {
      setFeedback({ text: 'Isi panduan dan gunakan maksimal 12 isian cepat yang valid, dipisahkan koma.', ok: false })
      return
    }
    lock.current = true
    setBusy(true)
    setFeedback(undefined)
    try {
      await writeStockSettings({ guidelines_text: guidelines.trim(), quick_presets: quick, require_all_fields: required })
      setFeedback({ text: 'Aturan pengisian tersimpan.', ok: true })
      onSaved('')
    } catch (cause) {
      setFeedback({ text: errorMessage(cause, 'Aturan gagal disimpan.'), ok: false })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }}>
    <h2>Aturan pengisian</h2>
    <fieldset className="stack stock-fieldset" disabled={busy}>
      <label className="field">Panduan karyawan<textarea required maxLength={2000} rows={5}
        value={guidelines} onChange={e => setGuidelines(e.target.value)} /></label>
      <label className="field">Isi cepat, pisahkan dengan koma<input maxLength={320} placeholder="-, 1/4, 1/2, 1, 2"
        value={presets} onChange={e => setPresets(e.target.value)} /></label>
      <label className="remember-account"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Wajib mengisi semua barang</label>
      {feedback && (feedback.ok ? <StockToast message={feedback.text} /> : <Notice tone="error">{feedback.text}</Notice>)}
      <button className="button button-primary" type="submit">{busy ? 'Menyimpan…' : 'Simpan aturan'}</button>
    </fieldset>
  </form>
}

function MasterDialog({ editor, categories, onClose, onSaved }: {
  editor: Editor; categories: Category[]; onClose: () => void; onSaved: (message: string) => void
}) {
  const item = editor.table === 'so_items' ? editor.row : undefined
  const editingItem = editor.table === 'so_items'
  const subject = editingItem ? 'barang' : 'kategori'
  const [name, setName] = useState(editor.row?.name ?? '')
  const [order, setOrder] = useState(editor.row?.sort_order ?? 0)
  const [active, setActive] = useState(editor.row?.is_active ?? true)
  const [category, setCategory] = useState(item?.category_id ?? categories[0]?.id ?? '')
  const [unit, setUnit] = useState(item?.unit_label ?? 'pcs')
  const [combined, setCombined] = useState(item?.unit_type === 'combined')
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [id] = useState(() => editor.row?.id ?? crypto.randomUUID())
  const lock = useRef(false)

  async function save(remove = false) {
    if (lock.current) return
    if (!remove && (!name.trim() || (editingItem && !combined && !unit.trim()) || !Number.isInteger(order))) {
      setError('Periksa nama, satuan, dan urutan.')
      return
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const base = { name: name.trim(), sort_order: order, is_active: active }
      const fields = editingItem ? {
        ...base, category_id: category, unit_type: combined ? 'combined' as const : 'single' as const,
        unit_label: combined ? 'kardus + pcs' : unit.trim(),
      } : base
      await writeStockMaster(editor.table, id, !editor.row, remove ? undefined : fields)
      onSaved((editingItem ? 'Barang' : 'Kategori') + (remove ? ' dihapus.' : ' tersimpan.'))
    } catch (cause) {
      setError(errorMessage(cause, 'Perubahan belum dikonfirmasi.'))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <Dialog title={(editor.row ? 'Edit ' : 'Tambah ') + subject} className="stock-dialog" busy={busy} onClose={onClose}>
    <div className="stack">
      {error && <Notice tone="error">{error}</Notice>}
      {deleting ? <>
        <Notice tone="warning">Hapus {subject} {name}? Laporan yang sudah tersimpan tetap memakai data aslinya.</Notice>
        <div className="stock-actions">
          <button className="button button-secondary" disabled={busy} onClick={() => { setDeleting(false); setError('') }}>Batal</button>
          <button className="button button-primary" disabled={busy} onClick={() => void save(true)}>{busy ? 'Menghapus…' : 'Ya, hapus'}</button>
        </div>
      </> : <form onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset className="stack stock-fieldset" disabled={busy}>
          <label className="field">Nama {subject}<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
          {editingItem && <>
            <label className="field">Kategori<select required value={category} onChange={e => setCategory(e.target.value)}>
              {categories.map(row => <option key={row.id} value={row.id}>{row.name}{row.is_active ? '' : ' (nonaktif)'}</option>)}
            </select></label>
            <label className="field">Jenis satuan<select value={combined ? 'combined' : 'single'} onChange={e => setCombined(e.target.value === 'combined')}>
              <option value="single">Satuan tunggal</option><option value="combined">Kardus + pcs</option>
            </select></label>
            {!combined && <label className="field">Satuan<input required maxLength={40} placeholder="pcs, botol, roll, ball, atau ranting"
              value={unit} onChange={e => setUnit(e.target.value)} /></label>}
          </>}
          <label className="field">Urutan tampil<input type="number" required min={-1000000} max={1000000} value={Number.isNaN(order) ? '' : order}
            onChange={e => setOrder(e.target.valueAsNumber)} /></label>
          <label className="remember-account"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Tampilkan di form karyawan</label>
          <div className="stock-actions">
            <button className="button button-primary" type="submit">{busy ? 'Menyimpan…' : 'Simpan'}</button>
            {editor.row && <button className="button button-quiet" type="button"
              onClick={() => { setDeleting(true); setError('') }}>Hapus {subject}</button>}
          </div>
        </fieldset>
      </form>}
    </div>
  </Dialog>
}
