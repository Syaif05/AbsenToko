import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { AttendanceStatus } from '../components/AttendanceStatus'
import { EmployeeSelector } from '../components/EmployeeSelector'
import { Header, Loading, Notice, errorMessage } from '../components/ui/shared'
import { TeaHero } from '../components/ui/TeaHero'
import { EvidenceForm } from '../features/attendance/EvidenceForm'
import { useOnline } from '../features/attendance/browser'
import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import { actionLabels } from '../features/attendance/types'
import type { Action, AttendanceStatus as Status, Employee } from '../features/attendance/types'
import { demoPin } from '../features/demo/store'
import { demoMode, endAccount, forgetAccount, listEmployees, readSavedAccount, refreshStatus,
  saveAccount, savedAccountKey, SessionEnded, verifyEmployee } from '../features/attendance/api'
import type { Account } from '../features/attendance/api'

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
  const [account, setAccount] = useState(readSavedAccount)
  const [status, setStatus] = useState<Status | null>(null)
  const [remember, setRemember] = useState(true)
  const [accountNotice, setAccountNotice] = useState('')
  const [accountError, setAccountError] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusReload, setStatusReload] = useState(0)
  const session = account && status ? { ...account, status } : null
  const [action, setAction] = useState<Action | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const online = useOnline()
  const pageHeading = useRef<HTMLHeadingElement>(null)
  const formHeading = useRef<HTMLHeadingElement>(null)
  const stage = action ? 'capture' : confirmation ? 'confirmation' : account ? 'status' : 'selection'
  const previousStage = useRef(stage)

  useEffect(() => {
    if (account) return
    let current = true
    listEmployees().then((employees) => {
      if (current) setList({ kind: 'ready', employees })
    }, (error: unknown) => {
      if (current) setList({ kind: 'error', message: errorMessage(error, 'Daftar karyawan belum bisa dimuat.') })
    })
    return () => { current = false }
  }, [reload, account])

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
      const { status, ...next } = await verifyEmployee(employee, pin)
      setAccountNotice(!demoMode && remember && !saveAccount(next)
        ? 'Browser tidak dapat menyimpan sesi. Anda tetap masuk selama halaman ini terbuka.' : '')
      setAccountError('')
      setStatus(status)
      setAccount(next)
    } catch (error) {
      setError(errorMessage(error, 'PIN belum bisa diperiksa. Coba lagi.'))
    } finally {
      setPin('')
      setVisible(false)
      setVerifying(false)
    }
  }

  function clearAccount(previous: Account, message = '') {
    forgetAccount(previous)
    setAccount(null)
    setStatus(null)
    setAction(null)
    setConfirmation(null)
    setBusy(false)
    setError(message)
  }

  function confirm(at: string) {
    if (!account || !action) return
    setConfirmation({ action, at, employee: account.employee })
    setAction(null)
    setStatus(null)
  }

  async function logout() {
    if (!account || busy) return
    setBusy(true)
    setAccountError('')
    try {
      await endAccount(account)
      clearAccount(account)
    } catch (error) {
      if (error instanceof SessionEnded) clearAccount(account)
      else setAccountError(errorMessage(error, 'Belum bisa keluar. Coba lagi.'))
    } finally {
      setBusy(false)
    }
  }

  async function startAttendance() {
    if (!account || busy || !online) return
    setBusy(true)
    setAccountError('')
    try {
      const latest = await refreshStatus(account)
      setStatus(latest)
      if (latest.kind === 'NOT_CHECKED_IN') setAction('IN')
      if (latest.kind === 'CHECKED_IN') setAction('OUT')
    } catch (error) {
      if (error instanceof SessionEnded) clearAccount(account, error.message)
      else setAccountError(errorMessage(error, 'Status absensi belum bisa dimuat.'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!account || action || confirmation || busy || !online) return
    let current = true
    let refreshing = false
    async function refresh() {
      if (!account || refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      setAccountError('')
      try {
        const latest = await refreshStatus(account)
        if (current) setStatus(latest)
      } catch (error) {
        if (!current) return
        if (error instanceof SessionEnded) clearAccount(account, error.message)
        else setAccountError(errorMessage(error, 'Status absensi belum bisa dimuat.'))
      } finally {
        refreshing = false
      }
    }
    void refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => {
      current = false
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [account, action, confirmation, busy, online, statusReload])

  useEffect(() => {
    if (!account?.expiresAt || action || confirmation || busy) return
    const timer = window.setTimeout(() => clearAccount(account, 'Sesi habis. Masukkan PIN kembali.'),
      Math.max(0, account.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [account, action, confirmation, busy])

  useEffect(() => {
    if (!account?.token) return
    function syncLogout(event: StorageEvent) {
      if (!account || event.key !== savedAccountKey || event.newValue !== null) return
      try {
        if (JSON.parse(event.oldValue ?? 'null')?.token === account.token) clearAccount(account)
      } catch { /* Ignore unrelated or malformed storage values. */ }
    }
    window.addEventListener('storage', syncLogout)
    return () => window.removeEventListener('storage', syncLogout)
  }, [account])

  const expiry = account?.expiresAt ? new Date(account.expiresAt) : null
  const nextAction = session?.status.kind === 'NOT_CHECKED_IN' ? 'IN'
    : session?.status.kind === 'CHECKED_IN' ? 'OUT' : null

  return (
    <>
      <Header><Link className="button header-link" to="/owner/login">Masuk Owner</Link></Header>
      <main className={'tea-shell' + (stage === 'capture' ? ' tea-shell-capture' : '')}>
        <TeaHero>
          <p className="tea-eyebrow"><span aria-hidden="true" />Tim Kedai</p>
          <h1 ref={pageHeading} tabIndex={-1}>Absensi karyawan</h1>
          <p className="tea-date">{displayDate(todayWib())} · WIB</p>
        </TeaHero>
        <div className="tea-workspace">
          {!online && <Notice tone="warning">Koneksi internet diperlukan untuk mengirim absensi.</Notice>}
          {action && session ? (
            <EvidenceForm session={session} action={action} headingRef={formHeading} onBack={() => { setStatus(null); setAction(null) }} onSuccess={confirm} />
          ) : confirmation ? (
            <section className="panel stack success-panel">
              <div className="success-mark" aria-hidden="true">✓</div>
              <h2 ref={formHeading} tabIndex={-1}>{demoMode ? 'Absensi demo berhasil' : 'Absensi berhasil'}</h2>
              <p>{confirmation.employee.name} · {actionLabels[confirmation.action]}</p>
              <p className="confirmation-time">{displayTime(confirmation.at)} <small>WIB</small></p>
              <button className="button button-primary w-full" type="button" onClick={() => setConfirmation(null)}>Kembali ke Akun</button>
            </section>
          ) : account ? (
            <section className="panel stack account-panel">
              <div className="account-heading">
                <span className="avatar" aria-hidden="true">{Array.from(account.employee.name)[0]?.toLocaleUpperCase('id')}</span>
                <div><p className="panel-kicker">Akun karyawan</p><h2 ref={formHeading} tabIndex={-1}>{account.employee.name}</h2></div>
              </div>
              <p className="muted">{expiry ? 'Sesi berlaku sampai ' + (todayWib(expiry) === todayWib() ? '' : 'besok, ') + displayTime(expiry.toISOString()) + ' WIB' : ''}</p>
              {accountNotice && <Notice>{accountNotice}</Notice>}
              {accountError && <Notice tone="error">{accountError}</Notice>}
              {status ? <AttendanceStatus status={status} /> : online && !accountError && <Loading label="Memuat status absensi…" />}
              {nextAction && (
                <button className="button button-primary w-full" type="button" disabled={!online || busy} onClick={startAttendance}>
                  {actionLabels[nextAction]}
                </button>
              )}
              <button className="button button-secondary w-full" type="button" disabled={!online || busy}
                onClick={() => setStatusReload(value => value + 1)}>Perbarui Status</button>
              <button className="button button-quiet w-full" type="button" disabled={!online || busy} onClick={logout}>Keluar Akun</button>
            </section>
          ) : (
            <section className="panel stack" aria-labelledby="employee-login-title">
              <div className="panel-intro">
                <p className="panel-kicker">Portal karyawan</p>
                <h2 id="employee-login-title">Hai, tim!</h2>
                <p className="muted">Pilih nama dan masukkan PIN untuk mulai absen.</p>
              </div>
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
                  {!demoMode && <label className="remember-account">
                    <input type="checkbox" checked={remember} disabled={verifying} onChange={event => setRemember(event.target.checked)} />
                    <span>Tetap masuk di perangkat ini <small>Hilangkan centang jika perangkat dipakai bersama.</small></span>
                  </label>}
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
        </div>
      </main>
    </>
  )
}
