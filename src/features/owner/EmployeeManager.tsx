import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Notice, errorMessage } from '../../components/ui/shared'
import { useOnline } from '../attendance/browser'
import type { Employee } from '../attendance/types'
import { createEmployee, renameEmployee, resetEmployeePin, setEmployeeActive } from './api'

type Screen =
  | { kind: 'list' }
  | { kind: 'edit'; employee?: Employee }
  | { kind: 'confirm'; employee: Employee; action: 'reset' | 'toggle' }
  | { kind: 'pin'; name: string; pin: string }

export function EmployeeManager({ employees, onChange, onClose }: {
  employees: Employee[]; onChange: () => void; onClose: () => void
}) {
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const creationId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const online = useOnline()

  function go(next: Screen) {
    setScreen(next)
    setError('')
    setMessage('')
  }

  function edit(employee?: Employee) {
    creationId.current = null
    setName(employee?.name ?? '')
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
        const { pin } = await createEmployee(creationId.current, name)
        go({ kind: 'pin', name: name.trim(), pin })
      } else {
        await renameEmployee(id, name)
        go({ kind: 'list' })
        setMessage('Nama karyawan diperbarui.')
      }
    })
  }

  function confirm() {
    if (screen.kind !== 'confirm') return
    const { employee, action } = screen
    void run(async () => {
      if (action === 'reset') {
        const { pin } = await resetEmployeePin(employee.id)
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
      : screen.kind === 'confirm' ? (screen.action === 'reset' ? 'Reset PIN' : screen.employee.active ? 'Nonaktifkan Karyawan' : 'Aktifkan Karyawan')
        : 'Kelola Karyawan'

  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <div className="stack">
        {!online && <Notice tone="warning">Periksa koneksi internet untuk menyimpan perubahan.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        {screen.kind === 'list' && (
          <>
            <button className="button button-primary" type="button" onClick={() => edit()}>+ Tambah Karyawan</button>
            <ul className="manage-list">
              {employees.map((employee) => (
                <li key={employee.id}>
                  <div><strong>{employee.name}</strong><p className="muted">{employee.active ? 'Aktif' : 'Nonaktif'}</p></div>
                  <button className="button button-secondary" type="button" onClick={() => edit(employee)} aria-label={'Edit ' + employee.name}>Edit</button>
                </li>
              ))}
            </ul>
          </>
        )}
        {screen.kind === 'edit' && (
          <>
            <form className="stack" onSubmit={save}>
              <label className="field"><span>Nama karyawan</span>
                <input required maxLength={80} autoComplete="off" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
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
                }}>Reset PIN</button>
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
            <button className="button button-primary w-full" type="button" disabled={busy || !online} onClick={confirm}>
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
