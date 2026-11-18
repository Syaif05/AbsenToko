import { useRef, useState } from 'react'
import { confirmCheckout } from './api'
import { Notice, errorMessage } from '../../components/ui/shared'
import type { Attendance } from '../attendance/types'

export function CheckoutConfirmation({ record, onSaved }: { record: Attendance; onSaved: () => void }) {
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const submitting = useRef(false)
  const request = useRef<{ id: string; time: string; reason: string } | null>(null)
  if (record.checkOut || !record.id) return null
  return <form className="stack checkout-confirmation" onSubmit={async event => {
    event.preventDefault()
    if (submitting.current || busy || saved || !time || !record.id) return
    const instant = new Date(time + ':00+07:00')
    if (!Number.isFinite(instant.getTime())) { setError('Tanggal atau jam tidak valid.'); return }
    if (instant.getTime() < Date.parse(record.checkIn.at) || instant.getTime() > Date.now() || instant.getTime() > Date.parse(record.checkIn.at) + 48 * 3600000) { setError('Jam pulang harus setelah masuk, tidak di masa depan, dan maksimal 48 jam setelah masuk.'); return }
    if (reason.trim().length < 5) { setError('Alasan minimal 5 karakter.'); return }
    if (!request.current || request.current.time !== time || request.current.reason !== reason) request.current = { id: crypto.randomUUID(), time, reason }
    submitting.current = true
    setBusy(true); setError('')
    try { await confirmCheckout(request.current.id, record.id, instant.toISOString(), reason); setSaved(true); onSaved() }
    catch (cause) { setError(errorMessage(cause,'Konfirmasi gagal.')) }
    finally { submitting.current = false; setBusy(false) }
  }}>
    <h3>Konfirmasi pulang oleh Owner</h3>
    <p className="muted">Isi waktu pulang sebenarnya (WIB) dan alasan. Tindakan ini diaudit; foto dan lokasi pulang tidak dibuat otomatis.</p>
    <label className="field">Tanggal dan jam pulang (WIB)<input type="datetime-local" required value={time} disabled={busy || saved} onChange={event => setTime(event.target.value)} /></label>
    <label className="field">Alasan konfirmasi<textarea required minLength={5} maxLength={500} value={reason} disabled={busy || saved} onChange={event => setReason(event.target.value)} placeholder="Contoh: lupa absen pulang, waktu dikonfirmasi kepada karyawan." /></label>
    {error && <Notice tone="error">{error}</Notice>}
    {saved && <Notice tone="success">Jam pulang berhasil dikonfirmasi.</Notice>}
    <button className="button button-primary" disabled={busy || saved || reason.trim().length<5 || !time}>{busy ? 'Menyimpan…' : 'Konfirmasi jam pulang'}</button>
  </form>
}
