import { useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { CameraCapture } from '../../components/CameraCapture'
import { GpsCapture } from '../../components/GpsCapture'
import type { GpsState } from '../../components/GpsCapture'
import { Notice, errorMessage } from '../../components/ui/shared'
import { demoMode, findReceipt, prepareEvidence, submitEvidence } from './api'
import type { Attempt, Session } from './api'
import { getLocation, useOnline } from './browser'
import { actionLabels } from './types'
import type { Action } from './types'

const freshForMs = 120_000

export function EvidenceForm({ session, action, headingRef, onBack, onSuccess }: {
  session: Session; action: Action; headingRef: Ref<HTMLHeadingElement>; onBack: () => Promise<void>; onSuccess: (at: string) => void
}) {
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [gps, setGps] = useState<GpsState>({ kind: 'idle' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<(Attempt & { capturedAt: number }) | null>(null)
  const [retry, setRetry] = useState(false)
  const [expired, setExpired] = useState(false)
  const preparationId = useRef<string | null>(null)
  const submission = useRef(false)
  const locationRequest = useRef(0)
  const active = useRef(false)
  const online = useOnline()

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      locationRequest.current += 1
    }
  }, [])

  async function locate() {
    const request = ++locationRequest.current
    setGps({ kind: 'loading' })
    try {
      const location = await getLocation()
      if (locationRequest.current === request) setGps({ kind: 'ready', location, capturedAt: Date.now() })
    } catch (error) {
      if (locationRequest.current === request) {
        setGps({ kind: 'error', message: errorMessage(error, 'Lokasi belum ditemukan. Coba lagi.') })
      }
    }
  }

  async function send() {
    if (!photo || gps.kind !== 'ready' || !online || submission.current || expired) return
    setError('')
    if (session.expiresAt && Date.now() >= session.expiresAt) {
      setExpired(true)
      setError('Sesi habis. Kembali dan verifikasi PIN untuk melihat status terbaru.')
      return
    }
    if (!attempt.current && Date.now() - gps.capturedAt > freshForMs) {
      setError('Lokasi sebelumnya sudah terlalu lama. Tunggu lokasi terbaru, lalu kirim kembali.')
      void locate()
      return
    }
    submission.current = true
    setSending(true)
    try {
      const pending = attempt.current
      if (pending) {
        const receipt = await findReceipt(session, pending)
        if (receipt) {
          if (active.current) onSuccess(receipt.recorded_at)
          return
        }
        if (Date.now() - pending.capturedAt > freshForMs) {
          setExpired(true)
          setError('Lokasi percobaan sudah kedaluwarsa. Kembali untuk memeriksa status dan mengambil bukti baru.')
          return
        }
      }
      preparationId.current ??= crypto.randomUUID()
      const current = pending ?? { attemptId: preparationId.current, action, photo, location: gps.location, capturedAt: gps.capturedAt }
      if (!pending) await prepareEvidence(session, current)
      attempt.current = current
      setRetry(true)
      const result = await submitEvidence(session, current)
      if (active.current) onSuccess(result.recorded_at)
    } catch (error) {
      if (active.current) setError(navigator.onLine
        ? errorMessage(error, 'Foto belum berhasil dikirim. Coba lagi.')
        : 'Foto belum berhasil dikirim. Periksa koneksi dan coba lagi.')
    } finally {
      submission.current = false
      if (active.current) setSending(false)
    }
  }

  return (
    <section className="panel stack" aria-label={actionLabels[action]}>
      <div className="capture-intro">
        <div className="capture-heading">
          <h2 ref={headingRef} tabIndex={-1}>{actionLabels[action]}</h2>
          <button className="button button-quiet" type="button" disabled={sending} onClick={async () => {
            if (submission.current) return
            submission.current = true
            setSending(true)
            await onBack()
          }}>Kembali</button>
        </div>
        <p className="muted">{demoMode ? 'Bukti demo hanya tersedia di tab ini sampai dimuat ulang.' : 'Foto dan lokasi disimpan sebagai bukti absensi dan dapat dilihat oleh Owner.'}</p>
      </div>
      <CameraCapture photo={photo} onPhoto={setPhoto} onStart={locate} disabled={sending || retry || !online} />
      <GpsCapture state={gps} retry={locate} disabled={sending || retry || !online} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className={photo && gps.kind === 'ready' ? 'sticky-actions' : undefined}>
        <button className="button button-primary w-full" type="button" disabled={!photo || gps.kind !== 'ready' || sending || expired || !online} onClick={send}>
          {sending ? 'Memproses absensi…' : retry ? 'Periksa dan Coba Lagi' : 'Kirim ' + actionLabels[action]}
        </button>
      </div>
    </section>
  )
}
