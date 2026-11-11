import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { AttendanceStatus } from '../components/AttendanceStatus'
import { EmployeeSelector } from '../components/EmployeeSelector'
import { Header, Loading, Notice, errorMessage } from '../components/ui/shared'
import { TeaHero } from '../components/ui/TeaHero'
import { useOnline } from '../features/attendance/browser'
import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import { actionLabels } from '../features/attendance/types'
import type { Action, AttendanceStatus as Status, Employee, Store } from '../features/attendance/types'
import { attendanceEmployees, attendanceStores, selectEmployee, demoMode, endAccount, forgetAccount, readSavedAccount, refreshStatus,
  saveAccount, savedAccountKey, SessionEnded } from '../features/attendance/api'
import type { Account } from '../features/attendance/api'

const EvidenceForm = lazy(() => import('../features/attendance/EvidenceForm').then(module => ({ default: module.EvidenceForm })))

type Confirmation = { action: Action; at: string; employee: Employee }

export default function AttendancePage() {
  const [stores, setStores] = useState<Store[]>()
  const [storeId, setStoreId] = useState('')
  const [staff, setStaff] = useState<Employee[]>()
  const [directoryError, setDirectoryError] = useState('')
  const [directoryRetry, setDirectoryRetry] = useState(0)
  const [employeeId, setEmployeeId] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState(readSavedAccount)
  const [status, setStatus] = useState<Status | null>(null)
  const [remember, setRemember] = useState(false)
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
  const focusCaptureHeading = useCallback((element: HTMLHeadingElement | null) => { element?.focus() }, [])
  const previousStage = useRef(stage)

  useEffect(() => {
    if (account || !online) return
    let current = true
    void attendanceStores().then(data => {
      if (current) setStores(data)
    }, error => {
      if (current) setDirectoryError(errorMessage(error, 'Daftar toko belum bisa dimuat.'))
    })
    return () => { current = false }
  }, [account, online, directoryRetry])

  useEffect(() => {
    if (account || !storeId || !online) return
    let current = true
    void attendanceEmployees(storeId).then(data => {
      if (current) setStaff(data)
    }, error => {
      if (current) setDirectoryError(errorMessage(error, 'Daftar karyawan belum bisa dimuat.'))
    })
    return () => { current = false }
  }, [account, storeId, online, directoryRetry])

  useEffect(() => {
    if (stage === previousStage.current) return
    previousStage.current = stage
    const heading = stage === 'selection' ? pageHeading : formHeading
    heading.current?.focus()
  }, [stage])

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || verifying || !storeId || !employeeId || !staff?.some(person => person.id === employeeId)) return
    setVerifying(true)
    setError('')
    try {
      const { status, ...next } = await selectEmployee(storeId, employeeId)
      setAccountNotice(!demoMode && remember && !saveAccount(next)
        ? 'Browser tidak dapat menyimpan sesi. Anda tetap masuk selama halaman ini terbuka.' : '')
      setAccountError('')
      setStatus(status)
      setAccount(next)
    } catch (error) {
      setError(errorMessage(error, 'Sesi absensi belum bisa dibuka. Coba lagi.'))
    } finally {
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
    const timer = window.setTimeout(() => clearAccount(account, 'Sesi habis. Pilih toko dan nama kembali.'),
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
            <Suspense fallback={<section className="panel"><Loading label="Menyiapkan bukti absensi…" /></section>}>
              <EvidenceForm session={session} action={action} headingRef={focusCaptureHeading}
                onBack={() => { setStatus(null); setAction(null) }} onSuccess={confirm} />
            </Suspense>
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
              <p className="muted">{expiry ? 'Sesi berlaku sampai ' + (todayWib(expiry) === todayWib() ? '' : displayDate(todayWib(expiry)) + ', ') + displayTime(expiry.toISOString()) + ' WIB' : ''}</p>
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
                <p className="muted">Pilih toko dan nama Anda untuk mulai absen.</p>
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              {directoryError ? <>
                <Notice tone="error">{directoryError}</Notice>
                <button type="button" className="button button-secondary" disabled={!online} onClick={() => {
                  setDirectoryError('')
                  setDirectoryRetry(value => value + 1)
                }}>Coba Lagi</button>
              </> : !stores ? <Loading label="Memuat toko…" /> : stores.length === 0
                ? <Notice>Belum ada toko yang tersedia. Hubungi Owner.</Notice>
                : <form className="stack" onSubmit={verify}>
                  <label className="field">Pilih toko
                    <select required value={storeId} disabled={verifying || !online} onChange={event => {
                      setStoreId(event.target.value)
                      setEmployeeId('')
                      setStaff(undefined)
                      setError('')
                    }}>
                      <option value="">Pilih toko Anda</option>
                      {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
                    </select>
                  </label>
                  {storeId && (staff ? staff.length
                    ? <EmployeeSelector employees={staff} value={employeeId} onChange={setEmployeeId} disabled={verifying || !online} />
                    : <Notice>Belum ada karyawan aktif di toko ini.</Notice>
                    : <Loading label="Memuat karyawan…" />)}
                  {!demoMode && <label className="remember-account">
                    <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={verifying} />
                    <span>Ingat saya di perangkat ini</span>
                  </label>}
                  <button className="button button-primary w-full" disabled={!online || verifying || !staff?.some(person => person.id === employeeId)}>
                    {verifying ? 'Membuka absensi…' : 'Lanjutkan Absen'}
                  </button>
                </form>}
            </section>
          )}
          {demoMode && <footer className="demo-footer">
            <span className="demo-indicator" aria-hidden="true" />
            Mode demo · Data sementara
          </footer>}
        </div>
      </main>
    </>
  )
}
