import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Loading, Notice, errorMessage } from '../components/ui/shared'
import { useOnline } from '../features/attendance/browser'
import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import type { Employee } from '../features/attendance/types'
import { exportReport, reportRows } from '../features/owner/report'
import type { ReportFormat } from '../features/owner/report'
import { loadDashboard } from '../features/owner/api'
import { Dialog } from '../components/ui/Dialog'
import { dashboardRows } from '../features/owner/dashboard'

const AttendanceDetail = lazy(() =>
  import('../features/owner/AttendanceDetail').then((module) => ({
    default: module.AttendanceDetail,
  })),
)

export default function OwnerDashboardPage() {
  const [date, setDate] = useState(todayWib)
  const [snapshot, setSnapshot] = useState<{
    date: string
    data: Awaited<ReturnType<typeof loadDashboard>>
    at: string
  }>()
  const [store, setStore] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [revision, setRevision] = useState(0)
  const [settled, setSettled] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<Employee>()
  const [format, setFormat] = useState<ReportFormat>('xlsx')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const online = useOnline()
  const scope = date + ':' + revision
  const loading = online && settled !== scope
  const data = snapshot?.date === date ? snapshot.data : undefined
  const rows = data ? dashboardRows(data.employees, data.records, store) : []
  const visible = rows.filter(
    (row) =>
      row.employee.name.toLocaleLowerCase('id').includes(query.trim().toLocaleLowerCase('id')) &&
      (status === 'all' || row.status === status),
  )
  const active = rows.filter((row) => row.employee.active && !row.employee.archivedAt)
  const arrived = active.filter((row) => row.record).length
  const completed = active.filter((row) => row.record?.checkOut).length
  const percent = active.length ? Math.round((arrived / active.length) * 100) : 0
  const storeNames = new Map(data?.stores.map((item) => [item.id, item.name]))
  const stats = [
    ['Karyawan aktif', active.length, '♙'],
    ['Sudah masuk', arrived, '↗'],
    ['Belum masuk', active.length - arrived, '◷'],
    ['Sudah pulang', completed, '✓'],
  ] as const

  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    void loadDashboard(date, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setSnapshot({ date, data: result, at: new Date().toISOString() })
        setError('')
        setSettled(scope)
      },
      (cause) => {
        if (controller.signal.aborted) return
        setError(errorMessage(cause, 'Rekap gagal dimuat.'))
        setSettled(scope)
      },
    )
    return () => controller.abort()
  }, [date, scope, online])

  return (
    <main className="dashboard-shell owner-dashboard">
      <div className="owner-page-heading">
        <div>
          <p className="owner-eyebrow">AKTIVITAS TIM</p>
          <h1>Ringkasan absensi</h1>
          <p className="muted">Kehadiran tim, dalam satu tempat.</p>
        </div>
        <button
          className="button button-secondary"
          disabled={loading || !online}
          onClick={() => setRevision((value) => value + 1)}
        >
          {loading ? 'Memuat…' : '↻ Perbarui data'}
        </button>
      </div>
      <div className="owner-filters">
        <label className="field">
          Tanggal
          <input
            type="date"
            value={date}
            max={todayWib()}
            onChange={(event) => {
              if (event.target.value && event.target.validity.valid) {
                setDate(event.target.value)
                setDetail(undefined)
              }
            }}
          />
        </label>
        <label className="field">
          Toko
          <select
            value={store}
            onChange={(event) => {
              setStore(event.target.value)
              setDetail(undefined)
            }}
          >
            <option value="">Semua toko</option>
            <option value="unassigned">Toko historis belum tercatat</option>
            {snapshot?.data.stores.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
                {item.archivedAt ? ' (arsip)' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="owner-updated">
          {snapshot && data && 'Diperbarui ' + displayTime(snapshot.at) + ' WIB'}
        </span>
      </div>
      {!online && (
        <Notice tone="warning">
          Anda sedang offline. Data terakhir ditampilkan. Sambungkan internet untuk memperbarui.
        </Notice>
      )}
      {error && (
        <Notice tone="error">{error} Gunakan tombol Perbarui data untuk mencoba kembali.</Notice>
      )}
      <section className="owner-stats" aria-label="Ringkasan karyawan aktif">
        {stats.map(([label, value, icon]) => (
          <article key={label}>
            <span className="owner-stat-icon" aria-hidden="true">
              {icon}
            </span>
            <p>{label}</p>
            <strong>{data ? value : '—'}</strong>
            <small>{displayDate(date)}</small>
          </article>
        ))}
      </section>
      <div className="owner-overview">
        <section className="panel owner-progress">
          <div>
            <p className="owner-eyebrow">KEHADIRAN HARIAN</p>
            <h2>
              {data
                ? `${arrived} dari ${active.length} karyawan sudah masuk`
                : 'Menyiapkan ringkasan'}
            </h2>
            <p className="muted">{displayDate(date)} · WIB</p>
            <div
              className="owner-progress-track"
              role="progressbar"
              aria-label="Karyawan aktif sudah masuk"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: percent + '%' }} />
            </div>
            <small>Belum masuk berarti belum ada catatan pada tanggal ini.</small>
          </div>
          <strong className="owner-percentage">{data ? percent + '%' : '—'}</strong>
        </section>
        <section className="panel owner-shortcuts">
          <h2>Kelola tim</h2>
          <Link to="/owner/karyawan">
            Data karyawan <span>↗</span>
          </Link>
          <Link to="/owner/toko">
            Daftar toko <span>↗</span>
          </Link>
          <Link to="/owner/jadwal">
            Jadwal bulanan <span>↗</span>
          </Link>
        </section>
      </div>
      <section className="panel owner-records">
        <div className="owner-page-heading">
          <div>
            <h2>Daftar kehadiran</h2>
            <p className="muted">{data ? rows.length + ' karyawan dalam rekap' : 'Memuat rekap'}</p>
          </div>
          <div className="owner-export">
            <label className="sr-only" htmlFor="export-format">
              Format laporan
            </label>
            <select
              id="export-format"
              value={format}
              onChange={(event) => setFormat(event.target.value as ReportFormat)}
            >
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="print">PDF / Cetak</option>
            </select>
            <button
              className="button button-primary"
              disabled={!data || loading || !!error || exporting}
              onClick={async () => {
                if (!data) return
                setExporting(true)
                setExportError('')
                try {
                  await exportReport(
                    format,
                    reportRows(
                      visible.map((row) => row.employee),
                      visible.flatMap((row) => (row.record ? [row.record] : [])),
                      data.stores,
                      date,
                    ),
                    date,
                    storeNames.get(store) ??
                      (store ? 'Toko historis belum tercatat' : 'Semua toko'),
                  )
                } catch (cause) {
                  setExportError(errorMessage(cause, 'Unduhan gagal. Coba lagi.'))
                } finally {
                  setExporting(false)
                }
              }}
            >
              {exporting ? 'Menyiapkan…' : '↓ Unduh'}
            </button>
          </div>
        </div>
        <div className="owner-table-filters">
          <label className="field">
            <span className="sr-only">Cari karyawan</span>
            <input
              type="search"
              placeholder="Cari nama karyawan…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="sr-only">Filter status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Semua status</option>
              <option value="waiting">Belum masuk</option>
              <option value="working">Sedang bekerja</option>
              <option value="done">Selesai</option>
            </select>
          </label>
        </div>
        {exportError && <Notice tone="error">{exportError}</Notice>}
        {loading && <Loading label="Memuat rekap absensi…" />}
        {data && !loading && visible.length === 0 && (
          <div className="empty-state">Tidak ada karyawan yang sesuai dengan filter.</div>
        )}
        {data && (
          <>
            <div className="owner-table-head" aria-hidden="true">
              <span>Karyawan</span>
              <span>Status</span>
              <span>Masuk</span>
              <span>Pulang</span>
              <span />
            </div>
            <ul className="owner-attendance-list" aria-busy={loading}>
              {visible.map(({ employee, record, status: state }) => (
                <li key={employee.id}>
                  <button onClick={() => setDetail(employee)} className="owner-attendance-row">
                    <span className="owner-person">
                      <span className="owner-avatar" aria-hidden="true">
                        {employee.name.trim().slice(0, 2).toLocaleUpperCase('id')}
                      </span>
                      <span>
                        <strong>{employee.name}</strong>
                        <small>
                          {storeNames.get((record ? record.storeId : employee.storeId) ?? '') ??
                            (record ? 'Toko historis belum tercatat' : 'Belum ditempatkan')}
                          {employee.archivedAt ? ' · Arsip' : !employee.active ? ' · Nonaktif' : ''}
                        </small>
                      </span>
                    </span>
                    <span className={'status status-' + state}>
                      {state === 'done'
                        ? 'Selesai'
                        : state === 'working'
                          ? 'Sedang bekerja'
                          : 'Belum masuk'}
                    </span>
                    <span className="owner-time">
                      <small>Masuk</small>
                      {record ? displayTime(record.checkIn.at) : '—'}
                    </span>
                    <span className="owner-time">
                      <small>Pulang</small>
                      {record?.checkOut ? displayTime(record.checkOut.at) : '—'}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {detail && (
        <Suspense
          fallback={
            <Dialog title="Detail absensi" onClose={() => setDetail(undefined)}>
              <Loading label="Memuat detail…" />
            </Dialog>
          }
        >
          <AttendanceDetail
            employee={detail}
            date={date}
            record={data?.records.find((record) => record.employeeId === detail.id)}
            onClose={() => setDetail(undefined)}
          />
        </Suspense>
      )}
    </main>
  )
}
