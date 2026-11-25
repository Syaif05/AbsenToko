import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Notice, errorMessage } from '../../components/ui/shared'
import { descriptionLimit, imageBytes, issuePages, maxImages, submitIssue } from './api'
import type { IssueSource } from './api'
import { VoiceCapture } from './VoiceCapture'

type LocalAttachment = { file: File; url: string }
const imageTypes = ['image/jpeg', 'image/png', 'image/webp']

export default function IssueDialog({ source, onClose, onSent }: {
  source: IssueSource; onClose: () => void; onSent?: () => void
}) {
  const [message, setMessage] = useState('')
  const [images, setImages] = useState<LocalAttachment[]>([])
  const [voice, setVoice] = useState<LocalAttachment | null>(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState('')
  const [error, setError] = useState('')
  const [imageError, setImageError] = useState('')
  const urls = useRef(new Set<string>())
  const requestId = useRef('')
  const inFlight = useRef(false)

  useEffect(() => {
    const activeUrls = urls.current
    return () => { activeUrls.forEach(url => URL.revokeObjectURL(url)); activeUrls.clear() }
  }, [])

  function preview(file: File) {
    const url = URL.createObjectURL(file)
    urls.current.add(url)
    return { file, url }
  }
  function release(url: string) {
    URL.revokeObjectURL(url)
    urls.current.delete(url)
  }

  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length + images.length > maxImages) {
      setImageError('Maksimal lima gambar. Hapus gambar atau pilih lebih sedikit.')
      return
    }
    if (files.some(file => !imageTypes.includes(file.type) || file.size === 0 || file.size > imageBytes)) {
      setImageError('Pilih gambar JPG, PNG, atau WebP dengan ukuran maksimal 4 MB per gambar.')
      return
    }
    setImageError('')
    requestId.current = ''
    setImages([...images, ...files.map(preview)])
  }

  function removeImage(url: string) {
    release(url)
    requestId.current = ''
    setImageError('')
    setImages(images.filter(image => image.url !== url))
  }

  function changeVoice(file: File | null) {
    if (voice) release(voice.url)
    setVoice(file ? preview(file) : null)
    requestId.current = ''
  }

  function leave(next: () => void) {
    if (inFlight.current) return
    if (receipt || !(message.trim() || images.length || voice || recording) ||
      window.confirm('Tinggalkan laporan? Isian dan lampiran belum dikirim.')) next()
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || recording) return
    if (message.trim().length < 10) { setError('Jelaskan kendala dengan minimal 10 karakter.'); return }
    const id = requestId.current || crypto.randomUUID()
    requestId.current = id
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const result = await submitIssue(source, id, message, images.map(image => image.file), voice?.file ?? null)
      if (result.id !== id) throw new Error('Penerimaan laporan belum terkonfirmasi. Coba kirim ulang.')
      setReceipt(result.id)
      urls.current.forEach(url => URL.revokeObjectURL(url))
      urls.current.clear()
      onSent?.()
    } catch (cause) {
      setError(errorMessage(cause, 'Laporan belum terkirim. Coba lagi.'))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <Dialog title={receipt ? 'Laporan diterima' : 'Laporkan masalah'} className="issue-dialog"
    onClose={() => leave(onClose)} busy={busy}>
    {receipt ? <div className="stack issue-receipt">
      <Notice tone="success">Laporan tersimpan di kotak masuk Owner.</Notice>
      <p>Nomor laporan <strong className="issue-code">#{receipt.slice(0, 8).toUpperCase()}</strong></p>
      <button type="button" className="button button-primary" onClick={onClose}>Selesai</button>
    </div> : <form className="stack" onSubmit={send}>
      <div className="issue-context">
        <span>Halaman</span>
        <strong>{issuePages[source.page] ?? issuePages['/owner']}</strong>
      </div>
      <fieldset className="issue-fields stack" disabled={busy}>
        <label className="issue-message">
          <strong>Jelaskan kendalanya</strong>
          <textarea required rows={6} maxLength={descriptionLimit} value={message}
            placeholder="Contoh: Saya membuka jadwal, memilih bulan ini, lalu layar menampilkan pesan gagal memuat."
            onChange={event => { setMessage(event.target.value); requestId.current = ''; setError('') }} />
          <small className="muted">{message.length.toLocaleString('id-ID')} / 12.000 karakter</small>
        </label>
        <div className="issue-media stack">
          <div className="issue-attachment-head"><strong>Gambar</strong><small>{images.length}/{maxImages} · maks. 4 MB per gambar</small></div>
          <p className="muted">Lampirkan tangkapan layar pesan atau bagian yang bermasalah.</p>
          {images.length > 0 && <ul className="issue-thumbnails">
            {images.map((image, index) => <li key={image.url}>
              <img src={image.url} alt={'Pratinjau gambar ' + (index + 1)} />
              <button type="button" className="issue-remove" onClick={() => removeImage(image.url)}
                aria-label={'Hapus gambar ' + (index + 1)}>×</button>
            </li>)}
          </ul>}
          {imageError && <Notice tone="error">{imageError}</Notice>}
          {images.length < maxImages && <label className="issue-file-input">
            <span className="button button-secondary">+ Tambah gambar</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Tambah gambar" onChange={addImages} />
          </label>}
        </div>
        <VoiceCapture voice={voice} onVoice={changeVoice} onActive={setRecording} />
      </fieldset>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="muted issue-privacy">Hanya Owner yang dapat membuka laporan dan lampiran. Jangan sertakan PIN atau kata sandi.</p>
      <div className="issue-footer">
        <button type="submit" className="button button-primary" disabled={busy || recording}>
          {busy ? 'Mengirim…' : 'Kirim laporan'}
        </button>
      </div>
    </form>}
  </Dialog>
}
