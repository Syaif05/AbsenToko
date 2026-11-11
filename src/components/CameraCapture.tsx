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
  const width = Math.min(video.videoWidth, video.videoHeight * 3 / 4)
  const height = width * 4 / 3
  const ratio = Math.min(1, 960 / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Foto belum bisa diambil.')
  context.drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
    width, height, 0, 0, canvas.width, canvas.height)
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
  const dialog = useRef<HTMLDialogElement>(null)
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

  function close() {
    operation.current += 1
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    dialog.current?.close()
    setPhase('idle')
  }

  async function open() {
    const current = ++operation.current
    setError('')
    setReady(false)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Kamera tidak tersedia. Buka halaman ini melalui HTTPS atau localhost.')
      return
    }
    dialog.current?.showModal()
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
      close()
      setError(cameraError(error))
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
      close()
      onPhoto(captured)
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
        {preview ? <img src={preview} alt="Pratinjau foto absensi" /> : (
          <div className="camera-placeholder">
            <span className="camera-icon" aria-hidden="true" />
            <span>Foto absensi</span>
          </div>
        )}
      </div>
      {error && phase === 'idle' && <Notice tone="error">{error}</Notice>}
      <button className="button button-secondary w-full" type="button" disabled={disabled} onClick={open}>
        {photo ? 'Ambil Ulang Foto' : error ? 'Coba Lagi Kamera' : 'Aktifkan Kamera dan Lokasi'}
      </button>
      <dialog ref={dialog} className="camera-dialog" aria-labelledby="camera-title" onCancel={event => {
        event.preventDefault()
        close()
      }}>
        <div className="camera-screen">
          <div className="camera-toolbar">
            <h3 id="camera-title">Kamera absensi</h3>
            <button className="button button-secondary" type="button" onClick={close}>Tutup Kamera</button>
          </div>
          <div className="camera-stage">
            <video ref={video} hidden={!showVideo} autoPlay muted playsInline onCanPlay={() => setReady(true)} aria-label="Pratinjau kamera potret" />
            {!showVideo && <p role="status">Menunggu akses kamera…</p>}
          </div>
          <div className="camera-controls">
            {error && phase !== 'idle' && <Notice tone="error">{error}</Notice>}
            <button className="button button-primary" type="button" disabled={!ready || phase !== 'live'} onClick={takePhoto}>
              {phase === 'capturing' ? 'Memproses foto…' : 'Ambil Foto'}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  )
}
