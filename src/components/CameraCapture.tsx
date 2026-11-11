import { useEffect, useRef, useState } from 'react'
import { usePhotoUrl } from '../features/attendance/browser'
import { Notice } from './ui/shared'

function cameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Izin kamera belum diberikan. Aktifkan dari pengaturan browser.'
    }
    if (error.name === 'NotFoundError') return 'Kamera tidak ditemukan. Periksa perangkat, lalu coba lagi.'
  }
  return 'Kamera belum bisa digunakan. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.'
}

function snapshot(video: HTMLVideoElement) {
  const ratio = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * ratio)
  canvas.height = Math.round(video.videoHeight * ratio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Foto belum bisa diambil.')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((photo) => {
      if (photo?.type === 'image/jpeg' && photo.size <= 1_000_000) resolve(photo)
      else reject(new Error('Foto belum bisa diproses. Coba ambil ulang.'))
    }, 'image/jpeg', 0.78)
  })
}

export function CameraCapture({ photo, onPhoto, onStart, disabled }: {
  photo: Blob | null; onPhoto: (photo: Blob | null) => void; onStart: () => void; disabled: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const operation = useRef(0)
  const [phase, setPhase] = useState<'idle' | 'opening' | 'live' | 'capturing'>('idle')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const preview = usePhotoUrl(photo)

  useEffect(() => () => {
    operation.current += 1
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  async function open() {
    const current = ++operation.current
    setError('')
    setReady(false)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Kamera tidak tersedia. Buka halaman ini melalui HTTPS atau localhost.')
      return
    }
    onPhoto(null)
    onStart()
    setPhase('opening')
    try {
      let source: MediaStream
      try {
        source = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 960 }, height: { ideal: 720 } },
        })
      } catch (error) {
        if (!(error instanceof DOMException) || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error
        if (current !== operation.current) return
        source = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      }
      if (current !== operation.current || !video.current) {
        source.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = source
      video.current.srcObject = source
      setPhase('live')
    } catch (error) {
      if (current !== operation.current) return
      setError(cameraError(error))
      setPhase('idle')
    }
  }

  async function takePhoto() {
    if (!video.current?.videoWidth) return
    const current = operation.current
    setPhase('capturing')
    setError('')
    try {
      const captured = await snapshot(video.current)
      if (current !== operation.current) return
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = null
      video.current.srcObject = null
      onPhoto(captured)
      setPhase('idle')
    } catch (error) {
      if (current !== operation.current) return
      setError(error instanceof Error ? error.message : 'Foto belum bisa diambil.')
      setPhase('live')
    }
  }

  const showVideo = phase === 'live' || phase === 'capturing'
  return (
    <section className="capture-section" aria-label="Foto absensi">
      <div className="viewfinder">
        <video ref={video} hidden={!showVideo} autoPlay muted playsInline onCanPlay={() => setReady(true)} aria-label="Pratinjau kamera" />
        {preview && <img src={preview} alt="Pratinjau foto absensi" />}
        {!showVideo && !preview && (
          <div className="camera-placeholder">
            <span className="camera-icon" aria-hidden="true" />
            <span>{phase === 'opening' ? 'Menunggu akses kamera…' : 'Foto absensi'}</span>
          </div>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {showVideo ? (
        <button className="button button-secondary w-full" type="button" disabled={!ready || phase === 'capturing'} onClick={takePhoto}>
          {phase === 'capturing' ? 'Memproses foto…' : 'Ambil Foto'}
        </button>
      ) : (
        <button className="button button-secondary w-full" type="button" disabled={disabled || phase === 'opening'} onClick={open}>
          {photo ? 'Ambil Ulang Foto' : error ? 'Coba Lagi Kamera' : phase === 'opening' ? 'Membuka kamera…' : 'Aktifkan Kamera dan Lokasi'}
        </button>
      )}
    </section>
  )
}
