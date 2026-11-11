import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Notice, errorMessage } from '../../components/ui/shared'
import { useOnline } from '../attendance/browser'
import type { Employee, Store } from '../attendance/types'
import { createEmployee, renameEmployee, inviteEmployee, saveStore, setEmployeeActive } from './api'

type Screen =
  | { kind: 'list' }
  | { kind: 'stores' }
  | { kind: 'profile'; employee: Employee }
  | { kind: 'edit'; employee?: Employee }
  | { kind: 'confirm'; employee: Employee; action: 'invite' | 'toggle' }
  | { kind: 'link'; name: string; url: string }

export function EmployeeManager({ employees, stores, onChange, onClose }: {
  employees: Employee[]; stores: Store[]; onChange: () => void; onClose: () => void
}) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const creationId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const [query, setQuery] = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [copyFallback, setCopyFallback] = useState(false)
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState('')
  const [storeName, setStoreName] = useState('')
  const [editingStore, setEditingStore] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const online = useOnline()

  function go(next: Screen) {
    setCopyFallback(false)
    setScreen(next)
    setError('')
    setMessage('')
  }

  function edit(employee?: Employee) {
    creationId.current = null
    setName(employee?.name ?? '')
    setStoreId(employee?.storeId ?? '')
    go({ kind: 'edit', employee })
  }

  async function run(operation: () => Promise<void>, refresh = true) {
    if (inFlight.current || !online) return
    inFlight.current = true
    setError('')
    setBusy(true)
    try {
      await operation()
      if (refresh) onChange()
    } catch (error) {
      if (refresh) onChange()
      setError(errorMessage(error, 'Perubahan belum dikonfirmasi. Periksa daftar karyawan.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (screen.kind !== 'edit') return
    const id = screen.employee?.id
    void run(async () => {
      if (!id) {
        creationId.current ??= crypto.randomUUID()
        await createEmployee(creationId.current, name, storeId || null)
        go({ kind: 'list' })
        setMessage('Karyawan ditambahkan. Buka profilnya untuk membuat tautan aktivasi.')
      } else {
        await renameEmployee(id, name, storeId || null)
        go({ kind: 'list' })
        setMessage('Data karyawan diperbarui.')
      }
    })
  }

  function confirm() {
    if (screen.kind !== 'confirm') return
    const { employee, action } = screen
    void run(async () => {
      if (action === 'invite') {
        const { invitation } = await inviteEmployee(employee.id)
        const url = new URL('/aktivasi', location.origin)
        url.hash = 'aktivasi=' + invitation
        go({ kind: 'link', name: employee.name, url: url.href })
      } else {
        await setEmployeeActive(employee.id, !employee.active)
        go({ kind: 'list' })
        setMessage(employee.active ? 'Karyawan dinonaktifkan.' : 'Karyawan diaktifkan.')
      }
    })
  }

  async function copyLink(text: string) {
    setMessage('')
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Tautan aktivasi disalin.')
    } catch {
      setCopyFallback(true)
    }
  }

  const storeNames = new Map(stores.map(store => [store.id, store.name]))
  const search = query.trim().toLocaleLowerCase('id')
  const filteredEmployees = screen.kind === 'list' ? employees.filter(employee =>
    (!filterStore || (employee.storeId ?? 'unassigned') === filterStore)
    && employee.name.toLocaleLowerCase('id').includes(search),
  ) : []
  const title = screen.kind === 'profile' ? 'Profil Karyawan' : screen.kind === 'edit' ? (screen.employee ? 'Edit Karyawan' : 'Tambah Karyawan')
    : screen.kind === 'link' ? 'Tautan Aktivasi'
      : screen.kind === 'confirm' ? (screen.action === 'invite' ? 'Buat Tautan Aktivasi' : screen.employee.active ? 'Nonaktifkan Karyawan' : 'Aktifkan Karyawan')
        : screen.kind === 'stores' ? 'Kelola Toko' : 'Kelola Karyawan'

  return (
    <Dialog title={title} onClose={onClose} busy={busy} className="employee-manager">
      <div className="stack">
        {!online && <Notice tone="warning">Periksa koneksi internet untuk menyimpan perubahan.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        {screen.kind === 'list' && (
          <>
            <div className="manager-toolbar">
              <button className="button button-primary" type="button" onClick={() => edit()}>+ Tambah Karyawan</button>
              <button className="button button-secondary" type="button" onClick={() => {
                setEditingStore(''); setStoreName(''); go({ kind: 'stores' })
              }}>Kelola Toko</button>
            </div>
            <div className="manager-filters">
              <label className="field"><span>Cari karyawan</span>
                <input type="search" value={query} placeholder="Cari nama" onChange={event => setQuery(event.target.value)} />
              </label>
              <label className="field"><span>Toko</span>
                <select value={filterStore} onChange={event => setFilterStore(event.target.value)}>
                  <option value="">Semua toko</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                  <option value="unassigned">Belum ditempatkan</option>
                </select>
              </label>
            </div>
            <p className="manager-count muted" aria-live="polite">{filteredEmployees.length} karyawan</p>
            {filteredEmployees.length ? <ul className="manager-people">
              {filteredEmployees.map(employee => (
                <li key={employee.id}>
                  <span className="avatar" aria-hidden="true">{Array.from(employee.name)[0]?.toLocaleUpperCase('id')}</span>
                  <div className="manager-person">
                    <strong>{employee.name}</strong>
                    <p className="muted">{storeNames.get(employee.storeId ?? '') ?? 'Belum ditempatkan'}</p>
                    <span className={'status ' + (employee.active ? 'status-working' : 'status-waiting')}>
                      {employee.active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <button className="button button-secondary" type="button" onClick={() => go({ kind: 'profile', employee })} aria-label={'Profil ' + employee.name}>Profil</button>
                </li>
              ))}
            </ul> : <p className="manager-empty muted">{employees.length ? 'Tidak ada karyawan yang cocok.' : 'Belum ada karyawan.'}</p>}
          </>
        )}
        {screen.kind === 'profile' && <>
          <div className="manager-profile">
            <h3>{screen.employee.name}</h3>
            <p>{storeNames.get(screen.employee.storeId ?? '') ?? 'Belum ditempatkan'}</p>
            <p className="muted">{screen.employee.active ? 'Aktif' : 'Nonaktif'}</p>
          </div>
          <button className="button button-primary" disabled={busy || !online || !screen.employee.active || !screen.employee.storeId}
            onClick={() => go({ kind: 'confirm', employee: screen.employee, action: 'invite' })}>Buat Tautan Aktivasi</button>
          {!screen.employee.storeId && <Notice>Tentukan toko karyawan terlebih dahulu.</Notice>}
          <button className="button button-secondary" disabled={busy} onClick={() => edit(screen.employee)}>Edit Profil</button>
          <button className="button button-quiet" disabled={busy} onClick={() => go({ kind: 'list' })}>Kembali</button>
        </>}
        {screen.kind === 'stores' && <>
          <form className="stack" onSubmit={event => {
            event.preventDefault()
            void run(async () => {
              await saveStore(editingStore || crypto.randomUUID(), storeName, !editingStore)
              setEditingStore(''); setStoreName(''); setMessage('Toko disimpan.')
            })
          }}>
            <label className="field"><span>{editingStore ? 'Ubah nama toko' : 'Nama toko baru'}</span>
              <input required maxLength={80} value={storeName} disabled={busy} onChange={event => setStoreName(event.target.value)} />
            </label>
            <button type="submit" className="button button-primary" disabled={!online || busy || !storeName.trim()}>Simpan Toko</button>
          </form>
          <ul className="manage-list">
            {stores.map(store => <li key={store.id}><strong>{store.name}</strong>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => {
                setEditingStore(store.id); setStoreName(store.name); setMessage('')
              }}>Ubah Nama</button>
            </li>)}
          </ul>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => go({ kind: 'list' })}>Kembali</button>
        </>}
        {screen.kind === 'edit' && (
          <>
            <form className="stack" onSubmit={save}>
              <label className="field"><span>Nama karyawan</span>
                <input required maxLength={80} autoComplete="off" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="field"><span>Penempatan toko</span>
                <select value={storeId} disabled={busy} onChange={event => setStoreId(event.target.value)}>
                  <option value="">Belum ditempatkan</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
              <button className="button button-primary w-full" disabled={busy || !online || !name.trim()} type="submit">
                {busy ? 'Menyimpan…' : 'Simpan Karyawan'}
              </button>
            </form>
            {screen.employee && (
              <div className="manage-actions">
                <button className={'button ' + (screen.employee.active ? 'button-danger' : 'button-secondary')} type="button" disabled={busy} onClick={() => {
                  if (screen.employee) go({ kind: 'confirm', employee: screen.employee, action: 'toggle' })
                }}>{screen.employee.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
              </div>
            )}
            <button className="button button-quiet w-full" type="button" disabled={busy} onClick={() => go({ kind: 'list' })}>Kembali</button>
          </>
        )}
        {screen.kind === 'confirm' && (
          <>
            <p><strong>{screen.employee.name}</strong></p>
            <p className="muted">
              {screen.action === 'invite' ? 'Tautan berlaku 24 jam dan hanya bisa dipakai sekali. Membuat tautan baru mengakhiri akses perangkat lama.'
                : screen.employee.active ? 'Akses absensi akan dicabut. Riwayat tetap tersedia.' : 'Karyawan dapat menerima tautan aktivasi baru.'}
            </p>
            <button className="button button-primary w-full" type="button"
              disabled={busy || !online} onClick={confirm}>
              {busy ? 'Menyimpan…' : title}
            </button>
            <button className="button button-quiet w-full" type="button" disabled={busy} onClick={() => edit(screen.employee)}>Batal</button>
          </>
        )}
        {screen.kind === 'link' && <>
          <p>Kirim tautan ini secara pribadi kepada <strong>{screen.name}</strong>.</p>
          <button className="button button-primary" onClick={() => void copyLink(screen.url)}>Salin Tautan</button>
          {copyFallback && <label className="field">Salin tautan secara manual
            <textarea readOnly rows={3} value={screen.url} onFocus={event => event.currentTarget.select()} />
          </label>}
          <button className="button button-quiet" onClick={() => go({ kind: 'list' })}>Selesai</button>
        </>}
      </div>
    </Dialog>
  )
}
