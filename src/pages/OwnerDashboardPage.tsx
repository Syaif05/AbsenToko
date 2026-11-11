import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TransferIcon } from '../components/ui/TransferIcon'
import { Header, Loading, Notice, errorMessage } from '../components/ui/shared'
import { TeaHero } from '../components/ui/TeaHero'
import { useOnline } from '../features/attendance/browser'
import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import type { Attendance, Employee, Store } from '../features/attendance/types'
import { exportReport, reportRows } from '../features/owner/report'
import type { ReportFormat } from '../features/owner/report'
import { loadDashboard } from '../features/owner/api'
import { Dialog } from '../components/ui/Dialog'

const AttendanceDetail = lazy(() => import('../features/owner/AttendanceDetail').then(module => ({ default: module.AttendanceDetail })))

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
  const [exportFormat, setExportFormat] = useState<ReportFormat>('xlsx')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [date, setDate] = useState(todayWib)
  const [snapshot, setSnapshot] = useState<{ date: string; records: Attendance[]; employees: Employee[]; stores: Store[] }>()
  const [storeFilter, setStoreFilter] = useState('')
  const [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ date: string; revision: number }>()
  const [leaving, setLeaving] = useState(false)
  const [detail, setDetail] = useState<Employee | null>(null)
  const [error, setError] = useState('')
  const online = useOnline()
  const refreshing = loaded?.date !== date || loaded.revision !== revision
  const employees = snapshot?.employees ?? []
  const stores = snapshot?.stores ?? []
  const allRecords = snapshot?.date === date ? snapshot.records : []
  const records = storeFilter ? allRecords.filter(record => record.storeId === storeFilter) : allRecords
  const hasOtherRecord = new Set(storeFilter ? allRecords.filter(record => record.storeId !== storeFilter).map(record => record.employeeId) : [])
  const hasData = snapshot?.date === date
  const byEmployee = new Map(records.map((record) => [record.employeeId, record]))
  const active = employees.filter((employee) => employee.active
    && (!storeFilter || byEmployee.has(employee.id) || (employee.storeId === storeFilter && !hasOtherRecord.has(employee.id))))
  const checkedIn = active.filter((employee) => byEmployee.has(employee.id)).length
  const completed = active.filter((employee) => byEmployee.get(employee.id)?.checkOut).length
  const activeIds = new Set(active.map(employee => employee.id))
  const visible = employees.filter(employee => activeIds.has(employee.id) || byEmployee.has(employee.id))
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
          <nav className="manage-actions" aria-label="Menu Owner">
          <Link className="button hero-action" to="/owner/jadwal">Jadwal Karyawan</Link>
          <Link className="button hero-action" to="/owner/pengaturan">Pengaturan</Link>
          <Link className="button hero-action" to="/owner/karyawan">Kelola Karyawan</Link>
          <Link className="button hero-action" to="/owner/toko">Kelola Toko</Link>
          </nav>
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
              <label className="field"><span>Toko</span>
                <select value={storeFilter} onChange={event => setStoreFilter(event.target.value)}>
                  <option value="">Semua toko</option>
                  {stores.map(store => <option key={store.id} value={store.id}>{store.name}{store.archivedAt ? ' (arsip)' : ''}</option>)}
                </select>
              </label>
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
          <div className="report-toolbar">
            <label className="field"><span>Format laporan</span>
              <select value={exportFormat} onChange={event => setExportFormat(event.target.value as ReportFormat)}>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="print">PDF / Cetak</option>
              </select>
            </label>
            <button className="button button-secondary" disabled={!hasData || refreshing || !!error || exporting} onClick={async () => {
              setExportError('')
              setExporting(true)
              try {
                await exportReport(exportFormat, reportRows(visible, records, stores, date), date,
                  stores.find(store => store.id === storeFilter)?.name ?? 'Semua toko')
              } catch (error) {
                setExportError(errorMessage(error, 'Laporan belum bisa diunduh.'))
              } finally {
                setExporting(false)
              }
            }}><TransferIcon direction="down" /> {exporting ? 'Menyiapkan…' : 'Unduh Laporan'}</button>
          </div>
          {exportError && <Notice tone="error">{exportError}</Notice>}
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
      {detail && <Suspense fallback={<Dialog title="Detail Absensi" onClose={() => setDetail(null)}>
        <Loading label="Memuat detail absensi…" />
      </Dialog>}>
        <AttendanceDetail employee={detail} date={date} record={byEmployee.get(detail.id)} onClose={() => setDetail(null)} />
      </Suspense>}
    </>
  )
}
