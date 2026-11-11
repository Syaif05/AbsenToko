import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { AttendanceStatus } from '../components/AttendanceStatus'
import { EmployeeSelector } from '../components/EmployeeSelector'
import { Header, Loading, Notice, errorMessage } from '../components/ui/shared'
import { EvidenceForm } from '../features/attendance/EvidenceForm'
import { useOnline } from '../features/attendance/browser'
import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import { actionLabels } from '../features/attendance/types'
import type { Action, Employee } from '../features/attendance/types'
import { demoPin } from '../features/demo/store'
import { demoMode, listEmployees, refreshStatus, verifyEmployee } from '../features/attendance/api'
import type { Session } from '../features/attendance/api'

type EmployeeList =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; employees: Employee[] }
type Confirmation = { action: Action; at: string; employee: Employee }

export default function AttendancePage() {
  const [list, setList] = useState<EmployeeList>({ kind: 'loading' })
  const [reload, setReload] = useState(0)
  const [employeeId, setEmployeeId] = useState('')
  const [pin, setPin] = useState('')
  const [visible, setVisible] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const online = useOnline()
  const pageHeading = useRef<HTMLHeadingElement>(null)
  const formHeading = useRef<HTMLHeadingElement>(null)
  const stage = action ? 'capture' : confirmation ? 'confirmation' : session ? 'status' : 'selection'
  const previousStage = useRef(stage)

  useEffect(() => {
    let current = true
    listEmployees().then((employees) => {
      if (current) setList({ kind: 'ready', employees })
    }, (error: unknown) => {
      if (current) setList({ kind: 'error', message: errorMessage(error, 'Daftar karyawan belum bisa dimuat.') })
    })
    return () => { current = false }
  }, [reload])

  useEffect(() => {
    if (stage === previousStage.current) return
    previousStage.current = stage
    const heading = stage === 'selection' ? pageHeading : formHeading
    heading.current?.focus()
  }, [stage])

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || verifying) return
    setVerifying(true)
    setError('')
    try {
      const employee = list.kind === 'ready' && list.employees.find(item => item.id === employeeId)
      if (!employee) throw new Error('Pilih nama karyawan terlebih dahulu.')
      setSession(await verifyEmployee(employee, pin))
    } catch (error) {
      setError(errorMessage(error, 'PIN belum bisa diperiksa. Coba lagi.'))
    } finally {
      setPin('')
      setVisible(false)
      setVerifying(false)
    }
  }

  function reset() {
    setSession(null)
    setAction(null)
    setConfirmation(null)
    setPin('')
    setVisible(false)
    setError('')
  }

  function confirm(at: string) {
    if (!session || !action) return
    setConfirmation({ action, at, employee: session.employee })
    setAction(null)
    setSession(null)
  }

  async function backToStatus() {
    if (!session) return
    try {
      const status = await refreshStatus(session)
      setSession({ ...session, status })
      setAction(null)
    } catch {
      reset()
      setError('Verifikasi PIN kembali untuk melihat status absensi terbaru.')
    }
  }

  useEffect(() => {
    if (!session?.expiresAt || action) return
    const timer = window.setTimeout(() => {
      setSession(null)
      setError('Sesi habis. Masukkan PIN kembali.')
    }, Math.max(0, session.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [session, action])

  const nextAction = session?.status.kind === 'NOT_CHECKED_IN' ? 'IN'
    : session?.status.kind === 'CHECKED_IN' ? 'OUT' : null

  return (
    <>
      <Header><Link className="button header-link" to="/owner/login">Masuk Owner</Link></Header>
      <main className="narrow-shell">
        <div className="page-intro">
          <p className="date-label"><span aria-hidden="true" />{displayDate(todayWib())} · WIB</p>
          <h1 ref={pageHeading} tabIndex={-1}>Absensi karyawan</h1>
          {stage === 'selection' && <p className="muted">Pilih nama dan masukkan PIN untuk mulai.</p>}
        </div>
        {!online && <Notice tone="warning">Koneksi internet diperlukan untuk mengirim absensi.</Notice>}
        {action && session ? (
          <EvidenceForm session={session} action={action} headingRef={formHeading} onBack={backToStatus} onSuccess={confirm} />
        ) : confirmation ? (
          <section className="panel stack success-panel">
            <div className="success-mark" aria-hidden="true">✓</div>
            <h2 ref={formHeading} tabIndex={-1}>{demoMode ? 'Absensi demo berhasil' : 'Absensi berhasil'}</h2>
            <p>{confirmation.employee.name} · {actionLabels[confirmation.action]}</p>
            <p className="confirmation-time">{displayTime(confirmation.at)} <small>WIB</small></p>
            <button className="button button-primary w-full" type="button" onClick={reset}>Selesai</button>
          </section>
        ) : session ? (
          <section className="panel stack">
            <h2 ref={formHeading} tabIndex={-1}>{session.employee.name}</h2>
            <AttendanceStatus status={session.status} />
            {nextAction && (
              <button className="button button-primary w-full" type="button" disabled={!online} onClick={() => setAction(nextAction)}>
                {actionLabels[nextAction]}
              </button>
            )}
            <button className={'button w-full ' + (nextAction ? 'button-quiet' : 'button-primary')} type="button" onClick={reset}>Ganti Nama</button>
          </section>
        ) : (
          <section className="panel stack" aria-label="Verifikasi identitas">
            {list.kind === 'loading' && <Loading label="Memuat daftar karyawan…" />}
            {list.kind === 'error' && (
              <>
                <Notice tone="error">{list.message}</Notice>
                <button className="button button-secondary w-full" type="button" disabled={!online} onClick={() => {
                  setList({ kind: 'loading' })
                  setReload((value) => value + 1)
                }}>Coba Lagi</button>
              </>
            )}
            {list.kind === 'ready' && (list.employees.length ? (
              <form className="stack" onSubmit={verify}>
                <EmployeeSelector employees={list.employees} value={employeeId} onChange={(value) => {
                  setEmployeeId(value)
                  setPin('')
                  setError('')
                }} disabled={verifying} />
                <div className="pin-field">
                  <label className="field" htmlFor="employee-pin">PIN karyawan</label>
                  <div className="input-with-action">
                    <input id="employee-pin" type={visible ? 'text' : 'password'} inputMode="numeric" autoComplete="off"
                      placeholder="Masukkan PIN" required pattern="[0-9]{6,12}" maxLength={12} value={pin} disabled={verifying}
                      onChange={(event) => { setPin(event.target.value.replace(/[^0-9]/g, '')); setError('') }} />
                    <button type="button" className="button button-quiet" aria-controls="employee-pin" disabled={verifying} onClick={() => setVisible((value) => !value)}>
                      {visible ? 'Sembunyikan' : 'Tampilkan'}
                    </button>
                  </div>
                </div>
                {error && <Notice tone="error">{error}</Notice>}
                <button className="button button-primary w-full" type="submit" disabled={verifying || !online}>
                  {verifying ? 'Memeriksa PIN…' : 'Lanjutkan'}
                </button>
              </form>
            ) : <Notice>Belum ada karyawan aktif. Hubungi Owner.</Notice>)}
          </section>
        )}
        {demoMode && <footer className="demo-footer">
          <span className="demo-indicator" aria-hidden="true" />
          {stage === 'selection' ? 'Mode demo · PIN contoh ' + demoPin : 'Mode demo · Data sementara'}
        </footer>}
      </main>
    </>
  )
}
