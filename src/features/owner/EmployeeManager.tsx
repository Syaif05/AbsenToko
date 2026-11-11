import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Notice, errorMessage } from '../../components/ui/shared'
import { useOnline } from '../attendance/browser'
import type { Employee, Store } from '../attendance/types'
import { createEmployee, renameEmployee, resetEmployeePin, saveStore, setEmployeeActive } from './api'

type Screen =
  | { kind: 'list' }
  | { kind: 'stores' }
  | { kind: 'edit'; employee?: Employee }
  | { kind: 'confirm'; employee: Employee; action: 'reset' | 'toggle' }
  | { kind: 'pin'; name: string; pin: string }

export function EmployeeManager({ employees, stores, onChange, onClose }: {
  employees: Employee[]; stores: Store[]; onChange: () => void; onClose: () => void
}) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const creationId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState('')
  const [storeName, setStoreName] = useState('')
  const [editingStore, setEditingStore] = useState('')
  const [newPin, setNewPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const online = useOnline()

  function go(next: Screen) {
    setNewPin('')
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

  async function run(operation: () => Promise<void>) {
    if (inFlight.current || !online) return
    inFlight.current = true
    setError('')
    setBusy(true)
    try {
      await operation()
      onChange()
    } catch (error) {
      onChange()
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
        const { pin } = await createEmployee(creationId.current, name, storeId || null)
        go({ kind: 'pin', name: name.trim(), pin })
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
      if (action === 'reset') {
        const { pin } = await resetEmployeePin(employee.id, newPin || undefined)
        go({ kind: 'pin', name: employee.name, pin })
      } else {
        await setEmployeeActive(employee.id, !employee.active)
        go({ kind: 'list' })
        setMessage(employee.active ? 'Karyawan dinonaktifkan.' : 'Karyawan diaktifkan.')
      }
    })
  }

  const title = screen.kind === 'edit' ? (screen.employee ? 'Edit Karyawan' : 'Tambah Karyawan')
    : screen.kind === 'pin' ? 'PIN Karyawan'
      : screen.kind === 'confirm' ? (screen.action === 'reset' ? 'Ubah PIN' : screen.employee.active ? 'Nonaktifkan Karyawan' : 'Aktifkan Karyawan')
        : screen.kind === 'stores' ? 'Kelola Toko' : 'Kelola Karyawan'

  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <div className="stack">
        {!online && <Notice tone="warning">Periksa koneksi internet untuk menyimpan perubahan.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        {screen.kind === 'list' && (
          <>
            <button className="button button-primary" type="button" onClick={() => edit()}>+ Tambah Karyawan</button>
            <button className="button button-secondary" type="button" onClick={() => {
              setEditingStore(''); setStoreName(''); go({ kind: 'stores' })
            }}>Kelola Toko</button>
            <ul className="manage-list">
              {employees.map((employee) => (
                <li key={employee.id}>
                  <div><strong>{employee.name}</strong><p className="muted">{employee.active ? 'Aktif' : 'Nonaktif'} · {stores.find(store => store.id === employee.storeId)?.name ?? 'Belum ditempatkan'}</p></div>
                  <button className="button button-secondary" type="button" onClick={() => edit(employee)} aria-label={'Edit ' + employee.name}>Edit</button>
                </li>
              ))}
            </ul>
          </>
        )}
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
              {!screen.employee && <p className="muted">PIN awal dibuat otomatis setelah karyawan ditambahkan.</p>}
              <button className="button button-primary w-full" disabled={busy || !online || !name.trim()} type="submit">
                {busy ? 'Menyimpan…' : 'Simpan Karyawan'}
              </button>
            </form>
            {screen.employee && (
              <div className="manage-actions">
                <button className="button button-secondary" type="button" disabled={busy} onClick={() => {
                  if (screen.employee) go({ kind: 'confirm', employee: screen.employee, action: 'reset' })
                }}>Ubah PIN</button>
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
              {screen.action === 'reset' ? 'PIN lama akan berhenti berlaku. Bagikan PIN baru hanya kepada karyawan ini.' :
                screen.employee.active ? 'Nama disembunyikan dari pilihan absensi. Riwayat tetap tersedia.' : 'Nama akan tersedia kembali untuk absensi.'}
            </p>
            {screen.action === 'reset' && <label className="field"><span>PIN baru (opsional)</span>
              <input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={newPin}
                disabled={busy} onChange={event => setNewPin(event.target.value.replace(/[^0-9]/g, ''))} />
              <small>Kosongkan untuk membuat PIN acak. PIN lama tidak dapat dilihat.</small>
            </label>}
            <button className="button button-primary w-full" type="button"
              disabled={busy || !online || (screen.action === 'reset' && newPin.length > 0 && newPin.length < 6)} onClick={confirm}>
              {busy ? 'Menyimpan…' : title}
            </button>
            <button className="button button-quiet w-full" type="button" disabled={busy} onClick={() => edit(screen.employee)}>Batal</button>
          </>
        )}
        {screen.kind === 'pin' && (
          <>
            <p>PIN baru untuk <strong>{screen.name}</strong>. PIN ditampilkan satu kali.</p>
            <output className="issued-pin" aria-label="PIN baru">{screen.pin}</output>
            <button className="button button-primary w-full" type="button" onClick={() => go({ kind: 'list' })}>Selesai</button>
          </>
        )}
      </div>
    </Dialog>
  )
}
