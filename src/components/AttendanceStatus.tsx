import { displayDate, displayTime, todayWib } from '../features/attendance/dates'
import type { AttendanceStatus as Status } from '../features/attendance/types'
import { Notice } from './ui/shared'

export function AttendanceStatus({ status }: { status: Status }) {
  if (status.kind === 'EXPIRED') {
    return <Notice tone="error">Batas waktu absen pulang sudah lewat. Hubungi Owner untuk penanganan sesi ini.</Notice>
  }
  if (status.kind === 'NOT_CHECKED_IN') {
    return <span className="status status-waiting">Belum Masuk</span>
  }
  const { record } = status
  return (
    <div className="stack">
      <div>
        <span className={'status ' + (status.kind === 'COMPLETED' ? 'status-done' : 'status-working')}>
          {status.kind === 'COMPLETED' ? 'Selesai' : 'Sedang Bekerja'}
        </span>
      </div>
      {status.kind === 'COMPLETED' && <Notice tone="success">Absensi hari ini sudah lengkap.</Notice>}
      {record.workDate !== todayWib() && <p className="muted">{displayDate(record.workDate)}</p>}
      <dl className="time-pair">
        <div><dt>Jam masuk</dt><dd>{displayTime(record.checkIn.at)} <small>WIB</small></dd></div>
        <div><dt>Jam pulang</dt><dd>{record.checkOut ? displayTime(record.checkOut.at) : '—'} {record.checkOut && <small>WIB</small>}</dd></div>
      </dl>
    </div>
  )
}
