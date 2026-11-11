import { useEffect, useState } from 'react'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { mySchedule, SessionEnded } from './api'
import type { Account, PersonalSchedule } from './api'
import { todayWib, displayDate } from './dates'
import { monthDays, shifts, validMonth } from './schedule'

export function EmployeeSchedule({ account, online, onSessionEnded }: {
  account: Account; online: boolean; onSessionEnded: (message: string) => void
}) {
  const [month, setMonth] = useState(() => todayWib().slice(0, 7))
  const [result, setResult] = useState<{ month: string; data: PersonalSchedule } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!online || !validMonth(month)) return
    let current = true
    void mySchedule(account, month).then(data => {
      if (current) { setResult({ month, data }); setError('') }
    }, failure => {
      if (!current) return
      if (failure instanceof SessionEnded) onSessionEnded(failure.message)
      else setError(errorMessage(failure, 'Jadwal belum bisa dimuat.'))
    })
    return () => { current = false }
  }, [account, month, online, retry, onSessionEnded])
  const data = result?.month === month ? result.data : null
  const today = todayWib()
  const offset = validMonth(month) ? (new Date(month + '-01T12:00:00Z').getUTCDay() + 6) % 7 : 0
  const todayShift = data?.days.find(day => day.date === today)
  return <section className="panel stack employee-schedule" aria-labelledby="my-schedule-title">
    <div className="employee-section-heading"><div><p className="panel-kicker">Rencana kerja</p><h2 id="my-schedule-title">Jadwal Saya</h2></div>
      <button className="button button-quiet" type="button" disabled={!online} onClick={() => { setError(''); setResult(null); setRetry(value => value + 1) }}>Perbarui</button>
    </div>
    <label className="field">Bulan jadwal<input type="month" min="2000-01" max="2099-12" value={month} onChange={event => {
      if (validMonth(event.target.value)) { setMonth(event.target.value); setError('') }
    }} /></label>
    {error ? <Notice tone="error">{error} Tekan Perbarui untuk mencoba lagi.</Notice> : !data ? <Loading label={online ? 'Memuat jadwal…' : 'Hubungkan internet untuk melihat jadwal.'} /> : <>
      <p className="muted">{data.store.name}</p>
      {month === today.slice(0, 7) && <div className="employee-today"><span>Jadwal hari ini</span><strong>{todayShift ? shifts[todayShift.code] : 'Belum dijadwalkan'}</strong></div>}
      {!data.days.length && <Notice>Belum ada jadwal Anda untuk bulan ini. Jadwal akan tampil setelah dibuat Owner.</Notice>}
      <div className="employee-calendar" aria-label="Kalender jadwal pribadi">
        {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={'blank-' + index} aria-hidden="true" />)}
        {monthDays(month).map(day => {
          const date = month + '-' + String(day).padStart(2, '0')
          const shift = data.days.find(item => item.date === date)
          return <div key={date} className={'employee-day' + (shift ? ' employee-shift-' + shift.code : '') + (date === today ? ' employee-day-today' : '')}
            aria-current={date === today ? 'date' : undefined} aria-label={displayDate(date) + ': ' + (shift ? shifts[shift.code] : 'Belum dijadwalkan')}>
            <span>{day}</span><strong>{shift?.code ?? '—'}</strong>
          </div>
        })}
      </div>
      <ul className="employee-shift-legend">{Object.entries(shifts).map(([code, label]) => <li key={code}><b>{code}</b><span>{label}</span></li>)}</ul>
      <p className="muted employee-footnote">Jadwal adalah rencana kerja. Tetap lakukan absen dengan foto dan lokasi untuk mencatat kehadiran.</p>
    </>}
  </section>
}
