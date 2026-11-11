import { Dialog } from '../../components/ui/Dialog'
import { useEffect, useState } from 'react'
import { getPrivatePhoto } from './api'
import { displayDate, displayTime } from '../attendance/dates'
import { validLocation } from '../attendance/types'
import type { Attendance, Evidence, Employee } from '../attendance/types'

function EvidenceCard({ title, evidence }: { title: string; evidence?: Evidence }) {
  const id = evidence?.id
  const [retry, setRetry] = useState(0)
  const [photo, setPhoto] = useState<{ url: string } | { failed: true } | null>(null)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    void getPrivatePhoto(id, controller.signal).then(({ url }) => {
      if (!controller.signal.aborted) setPhoto({ url })
    }, () => {
      if (!controller.signal.aborted) setPhoto({ failed: true })
    })
    return () => controller.abort()
  }, [id, retry])
  const location = evidence?.location
  const coordinates = location && validLocation(location)
    ? location.latitude.toFixed(6) + ', ' + location.longitude.toFixed(6)
    : null
  return (
    <section className="evidence-card">
      <h3>{title}</h3>
      {evidence ? (
        <>
          {photo && 'url' in photo ? (
            <img className="evidence-image" src={photo.url} referrerPolicy="no-referrer"
              onError={() => setPhoto({ failed: true })} alt={'Bukti foto ' + title.toLowerCase()} />
          ) : photo ? (
            <button className="button button-secondary" type="button" onClick={() => {
              setPhoto(null)
              setRetry(value => value + 1)
            }}>Coba Muat Foto Lagi</button>
          ) : (
            <div className="evidence-placeholder" role="status">{id ? 'Memuat foto…' : 'Foto belum tersedia'}</div>
          )}
          <dl className="evidence-data">
            <div><dt>Waktu</dt><dd>{displayTime(evidence.at)} WIB</dd></div>
            {coordinates && location && (
              <>
                <div><dt>Koordinat</dt><dd>{coordinates}</dd></div>
                <div><dt>Akurasi</dt><dd>±{Math.round(location.accuracy)} m</dd></div>
              </>
            )}
          </dl>
          {coordinates && location && (
            <a className="button button-secondary w-full" href={'https://www.google.com/maps?q=' + encodeURIComponent(location.latitude + ',' + location.longitude)}
              target="_blank" rel="noopener noreferrer">Buka Google Maps <span aria-hidden="true">↗</span></a>
          )}
        </>
      ) : <p className="muted">Belum ada catatan.</p>}
    </section>
  )
}

export function AttendanceDetail({ employee, record, date, onClose }: {
  employee: Employee; record?: Attendance; date: string; onClose: () => void
}) {
  return (
    <Dialog title={employee.name} onClose={onClose}>
      <p className="muted sheet-date">{displayDate(date)} · WIB</p>
      <div className="evidence-grid">
        <EvidenceCard key={record?.checkIn.id ?? "in"} title="Absen Masuk" evidence={record?.checkIn} />
        <EvidenceCard key={record?.checkOut?.id ?? "out"} title="Absen Pulang" evidence={record?.checkOut} />
      </div>
    </Dialog>
  )
}
