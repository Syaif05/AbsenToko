import { useEffect, useRef, useState } from 'react'
import { Notice } from '../../components/ui/shared'
import { audioBytes, audioMinutes } from './api'

const duration = audioMinutes * 60
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']

type Voice = { file: File; url: string }

export function VoiceCapture({ voice, onVoice, onActive }: {
  voice: Voice | null; onVoice: (file: File | null) => void; onActive: (active: boolean) => void
}) {
  const [stage, setStage] = useState<'idle' | 'asking' | 'recording' | 'finishing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stopTracks = useRef<(() => void) | null>(null)
  const permissionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const available = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  function clearTimer() {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  useEffect(() => {
    function stopWhenHidden() {
      if (document.hidden && recorder.current?.state === 'recording') recorder.current.stop()
    }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      pending.current?.abort()
      if (permissionTimer.current) clearTimeout(permissionTimer.current)
      if (timer.current) clearInterval(timer.current)
      const active = recorder.current
      if (active) {
        active.onstop = null
        active.ondataavailable = null
        active.onerror = null
        if (active.state !== 'inactive') active.stop()
      }
      stopTracks.current?.()
    }
  }, [])

  function stop() {
    clearTimer()
    if (recorder.current?.state === 'recording') {
      setStage('finishing')
      recorder.current.stop()
    }
  }

  function cancelPermission() {
    pending.current?.abort()
    pending.current = null
    if (permissionTimer.current) clearTimeout(permissionTimer.current)
    permissionTimer.current = null
    setStage('idle')
    onActive(false)
  }

  async function record() {
    if (!available || pending.current || recorder.current) return
    const controller = new AbortController()
    pending.current = controller
    setStage('asking')
    setError('')
    onActive(true)
    permissionTimer.current = setTimeout(() => {
      cancelPermission()
      setError('Izin mikrofon belum dijawab. Anda bisa mencoba lagi atau mengirim tanpa rekaman.')
    }, 15_000)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const closeStream = () => stream.getTracks().forEach(track => track.stop())
      if (controller.signal.aborted) { closeStream(); return }
      if (permissionTimer.current) clearTimeout(permissionTimer.current)
      permissionTimer.current = null
      pending.current = null
      stopTracks.current = closeStream
      const mimeType = formats.find(type => MediaRecorder.isTypeSupported(type))
      const next = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 })
      recorder.current = next
      const chunks: Blob[] = []
      let failed = false
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      next.onerror = () => {
        failed = true
        setError('Rekaman terputus. Coba rekam ulang.')
        clearTimer()
        closeStream()
        recorder.current = null
        stopTracks.current = null
        onActive(false)
        setStage('idle')
      }
      next.onstop = () => {
        clearTimer()
        closeStream()
        if (failed) return
        recorder.current = null
        stopTracks.current = null
        setStage('idle')
        onActive(false)
        const stateType = (chunks[0]?.type || next.mimeType).toLowerCase().split(';')[0]
        const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' }
        const extension = extensions[stateType]
        const file = new File(chunks, 'rekaman.' + extension, { type: stateType })
        if (extension && file.size >= 12 && file.size <= audioBytes) onVoice(file)
        else setError('Rekaman kosong, terlalu besar, atau formatnya tidak didukung. Coba rekam ulang.')
      }
      next.start()
      setSeconds(0)
      setStage('recording')
      const started = Date.now()
      timer.current = setInterval(() => {
        const elapsed = Math.min(duration, Math.floor((Date.now() - started) / 1000))
        setSeconds(elapsed)
        if (elapsed >= duration) stop()
      }, 250)
    } catch (cause) {
      if (controller.signal.aborted) return
      cancelPermission()
      stopTracks.current?.()
      stopTracks.current = null
      recorder.current = null
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Izin mikrofon belum diberikan. Anda tetap bisa mengirim laporan teks.'
        : 'Mikrofon belum bisa digunakan. Periksa perangkat atau lanjutkan tanpa rekaman.')
    }
  }

  return <div className="issue-voice stack">
    <div className="issue-attachment-head"><strong>Rekaman suara</strong><small>Opsional · maks. {audioMinutes} menit</small></div>
    {error && <Notice tone="warning">{error}</Notice>}
    {voice ? <>
      <audio src={voice.url} controls preload="metadata" aria-label="Putar rekaman sebelum mengirim" />
      <button type="button" className="button button-quiet" onClick={() => onVoice(null)}>Hapus rekaman</button>
    </> : stage === 'recording' ? <div className="issue-recording">
      <span role="status"><span className="issue-record-dot" aria-hidden="true" /> Sedang merekam</span>
      <time aria-label="Durasi rekaman">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time>
      <button type="button" className="button button-secondary" onClick={stop}>Berhenti</button>
    </div> : stage === 'asking' ? <div className="issue-recording">
      <span role="status">Menunggu izin mikrofon…</span>
      <button type="button" className="button button-quiet" onClick={cancelPermission}>Batal</button>
    </div> : stage === 'finishing' ? <span role="status">Menyiapkan rekaman…</span>
      : available ? <button type="button" className="button button-secondary issue-record-button" onClick={() => void record()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6"/>
        </svg> Rekam suara
      </button> : <small className="muted">Perekaman tidak tersedia di browser ini.</small>}
  </div>
}
