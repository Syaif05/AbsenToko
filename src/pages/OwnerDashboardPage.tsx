import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Header, Notice, errorMessage } from '../components/ui/shared'
import { TeaHero } from '../components/ui/TeaHero'
import { useOnline } from '../features/attendance/browser'
import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import type { Attendance, Employee } from '../features/attendance/types'
import { loadDashboard } from '../features/owner/api'
import { AttendanceDetail } from '../features/owner/AttendanceDetail'
import { EmployeeManager } from '../features/owner/EmployeeManager'

const statIcons = {
  total: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm5-4a4 4 0 0 1 0 8',
  in: 'M12 5H5v14h7m-2-7h11m-4-4 4 4-4 4',
  waiting: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  out: 'm8 12 3 3 5-6m5 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toLocaleUpperCase('id')
}

function EmployeeRow({ employee, record, onClick }: {
  employee: Employee; record?: Attendance; onClick: () => void
}) {
  const state = record?.checkOut ? ['status-done', 'Selesai']
    : record ? ['status-working', 'Sedang Bekerja'] : ['status-waiting', 'Belum Masuk']
  return (
    <li>
      <button className="employee-row" type="button" onClick={onClick}>
        <span className="employee-name">
          <span className="avatar" aria-hidden="true">{initials(employee.name)}</span>
          <span><strong>{employee.name}</strong>{!employee.active && <small>Nonaktif</small>}</span>
        </span>
        <span className={'status ' + state[0]}>{state[1]}</span>
        <span className="row-time"><span>Masuk</span> <strong>{record ? displayTime(record.checkIn.at) : '—'}</strong></span>
        <span className="row-time"><span>Pulang</span> <strong>{record?.checkOut ? displayTime(record.checkOut.at) : '—'}</strong></span>
        <span className="row-arrow" aria-hidden="true">›</span>
      </button>
    </li>
  )
}

export default function OwnerDashboardPage({ onLogout }: { onLogout: () => Promise<void> }) {
  const [date, setDate] = useState(todayWib)
  const [snapshot, setSnapshot] = useState<{ date: string; records: Attendance[]; employees: Employee[] }>()
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ date: string; revision: number }>()
  const [leaving, setLeaving] = useState(false)
  const [detail, setDetail] = useState<Employee | null>(null)
  const [managing, setManaging] = useState(false)
  const [error, setError] = useState('')
  const online = useOnline()
  const refreshing = loaded?.date !== date || loaded.revision !== revision
  const employees = snapshot?.employees ?? []
  const records = snapshot?.date === date ? snapshot.records : []
  const hasData = snapshot?.date === date
  const byEmployee = new Map(records.map((record) => [record.employeeId, record]))
  const active = employees.filter((employee) => employee.active)
  const checkedIn = active.filter((employee) => byEmployee.has(employee.id)).length
  const completed = active.filter((employee) => byEmployee.get(employee.id)?.checkOut).length
  const visible = employees.filter((employee) => employee.active || byEmployee.has(employee.id))
  const stats = [
    ['Total Karyawan Aktif', active.length, 'total'],
    ['Sudah Masuk', checkedIn, 'in'],
    ['Belum Masuk', active.length - checkedIn, 'waiting'],
    ['Sudah Pulang', completed, 'out'],
  ] as const

  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    void loadDashboard(date, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setSnapshot({ date, ...data })
      setError('')
      setLoaded({ date, revision })
    }, error => {
      if (controller.signal.aborted) return
      setError(errorMessage(error, 'Rekap belum bisa dimuat.'))
      setLoaded({ date, revision })
    })
    return () => controller.abort()
  }, [date, revision, online])

  function refresh() {
    setError('')
    setRevision(value => value + 1)
  }

  async function logout() {
    setLeaving(true)
    try {
      await onLogout()
    } catch (error) {
      setError(errorMessage(error, 'Belum bisa keluar.'))
      setLeaving(false)
    }
  }

  return (
    <>
      <Header><button className="button header-link" type="button" disabled={leaving} onClick={logout}>{leaving ? "Keluar…" : "Keluar"}</button></Header>
      <main className="dashboard-shell">
        <TeaHero variant="dashboard">
          <p className="tea-eyebrow"><span aria-hidden="true" />Ruang Owner</p>
          <h1>Dashboard</h1>
          <p className="tea-date">{displayDate(date)} · WIB</p>
          <button className="button hero-action" type="button" disabled={!snapshot || !online} onClick={() => setManaging(true)}>Kelola Karyawan</button>
        </TeaHero>
        <section className="stats" aria-label="Ringkasan absensi karyawan aktif">
          {stats.map(([label, value, tone]) => (
            <article className={'stat stat-' + tone} key={label}>
              <span className="stat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={statIcons[tone]} />
                </svg>
              </span>
              <h2>{label}</h2><strong>{hasData ? value : "—"}</strong>
            </article>
          ))}
        </section>
        <section className="panel dashboard-panel" aria-labelledby="attendance-heading">
          <div className="list-toolbar">
            <div><p className="panel-kicker">Rekap harian</p><h2 id="attendance-heading">Daftar absensi</h2><p className="muted">Pilih karyawan untuk melihat detail.</p></div>
            <div className="list-actions">
              <label className="field"><span>Tanggal absensi</span>
                <input type="date" value={date} max={todayWib()} onChange={(event) => {
                  const value = event.target.value
                  if (value && event.target.validity.valid) { setError(''); setDate(value) }
                }} />
              </label>
              <button className="button button-secondary" type="button" disabled={refreshing || !online} onClick={refresh}>
                {refreshing ? 'Memuat…' : 'Perbarui'}
              </button>
            </div>
          </div>
          {!online && <Notice tone="warning">Koneksi terputus. Rekap diperbarui saat koneksi kembali.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {online && refreshing && <p role="status" className="empty-state">Memuat rekap…</p>}
          {hasData && !refreshing && records.length === 0 && <p className="empty-state">Belum ada absensi pada tanggal ini.</p>}
          {hasData && visible.length > 0 && (
            <>
              <div className="list-columns" aria-hidden="true"><span>Karyawan</span><span>Status</span><span>Masuk</span><span>Pulang</span><span /></div>
              <ul className="employee-list" aria-busy={refreshing}>
                {visible.map((employee) => <EmployeeRow key={employee.id} employee={employee} record={byEmployee.get(employee.id)} onClick={() => setDetail(employee)} />)}
              </ul>
            </>
          )}
        </section>
        <footer className="dashboard-footer">
          <Link to="/" className="button button-quiet">Buka Halaman Absensi</Link>
        </footer>
      </main>
      {detail && <AttendanceDetail employee={detail} date={date} record={byEmployee.get(detail.id)} onClose={() => setDetail(null)} />}
      {managing && <EmployeeManager employees={employees} onChange={refresh} onClose={() => setManaging(false)} />}
    </>
  )
}
