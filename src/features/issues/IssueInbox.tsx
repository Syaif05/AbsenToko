import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { displayDate, displayTime, todayWib } from '../attendance/dates'
import { changeIssueStatus, issueAttachments, issuePages, issueStatus, listIssues } from './api'
import type { Issue, IssueAttachment, IssueStatus } from './api'

function issueDate(instant: string) {
  return displayDate(todayWib(new Date(instant))) + ' · ' + displayTime(instant) + ' WIB'
}

export default function IssueInbox({ onClose, onStatusChanged }: { onClose: () => void; onStatusChanged: () => void }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof listIssues>>>()
  const [filter, setFilter] = useState<IssueStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Issue>()
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void listIssues(filter, page, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }, cause => {
      if (!controller.signal.aborted) setError(errorMessage(cause, 'Daftar laporan gagal dimuat.'))
    })
    return () => controller.abort()
  }, [filter, page, version])

  function refresh() {
    setResult(undefined)
    setError('')
    setVersion(value => value + 1)
  }

  function go(next: number) {
    refresh()
    setPage(next)
  }

  return <Dialog title="Laporan masalah" className="issue-dialog" busy={updating} onClose={onClose}>
    {selected ? <IssueDetail key={selected.id} issue={selected} onBack={() => setSelected(undefined)}
      onUpdating={setUpdating} onChange={status => {
        setSelected({ ...selected, status })
        refresh()
        onStatusChanged()
      }} /> : <div className="stack">
      <div className="issue-inbox-tools">
        <label>Status
          <select value={filter} onChange={event => { setFilter(event.target.value as typeof filter); go(0) }}>
            <option value="all">Semua laporan</option>
            {Object.entries(issueStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="button button-secondary" onClick={() => { go(0); onStatusChanged() }}>
          Muat ulang
        </button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : !result ? <Loading label="Memuat laporan masalah…" />
        : !result.issues.length ? <Notice>Belum ada laporan pada halaman ini.</Notice> : <ul className="issue-list">
          {result.issues.map(issue => <li key={issue.id}>
            <button type="button" className="issue-card" onClick={() => setSelected(issue)}>
              <div><strong>{issue.reporter_name} <span className="muted">· {issuePages[issue.page]}</span></strong>
                <span className={'issue-state issue-state-' + issue.status}>{issueStatus[issue.status]}</span>
              </div>
              <p>{issue.message}</p>
              <small className="muted">{issueDate(issue.created_at)}{issue.attachment_count ? ' · ' + issue.attachment_count + ' lampiran' : ''}</small>
            </button>
          </li>)}
        </ul>}
      {!error && result && (page > 0 || result.more) && <div className="issue-pagination">
        <button type="button" className="button button-secondary" disabled={!page} onClick={() => go(page - 1)}>Sebelumnya</button>
        <span>Halaman {page + 1}</span>
        <button type="button" className="button button-secondary" disabled={!result.more} onClick={() => go(page + 1)}>Berikutnya</button>
      </div>}
    </div>}
  </Dialog>
}

function IssueDetail({ issue, onBack, onUpdating, onChange }: {
  issue: Issue; onBack: () => void; onUpdating: (busy: boolean) => void; onChange: (status: IssueStatus) => void
}) {
  const [media, setMedia] = useState<IssueAttachment[]>()
  const [mediaError, setMediaError] = useState('')
  const [retry, setRetry] = useState(0)
  const [nextStatus, setNextStatus] = useState(issue.status)
  const [notice, setNotice] = useState('')
  const [statusError, setStatusError] = useState('')
  const [saving, setSaving] = useState(false)
  const sending = useRef(false)

  useEffect(() => {
    if (!issue.attachment_count) return
    const controller = new AbortController()
    void issueAttachments(issue.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setMedia(result.attachments)
    }, cause => {
      if (!controller.signal.aborted) setMediaError(errorMessage(cause, 'Lampiran belum bisa dibuka.'))
    })
    return () => controller.abort()
  }, [issue.id, issue.attachment_count, retry])

  async function saveStatus() {
    if (sending.current || nextStatus === issue.status) return
    sending.current = true
    setStatusError('')
    setNotice('')
    setSaving(true)
    onUpdating(true)
    try {
      const result = await changeIssueStatus(issue.id, nextStatus)
      if (result.id !== issue.id || result.status !== nextStatus) throw new Error('Perubahan status belum terkonfirmasi.')
      onChange(result.status)
      setNotice('Status laporan diperbarui.')
    } catch (cause) {
      setStatusError(errorMessage(cause, 'Status belum bisa disimpan.'))
    } finally {
      sending.current = false
      setSaving(false)
      onUpdating(false)
    }
  }

  return <section className="stack" aria-label="Detail laporan">
    <button type="button" className="button button-quiet issue-back" onClick={onBack} disabled={saving}>← Semua laporan</button>
    <div className="issue-context"><span>#{issue.id.slice(0, 8).toUpperCase()}</span>
      <strong>{issue.reporter_name} · {issuePages[issue.page]}</strong>
      <small>{issueDate(issue.created_at)}</small>
    </div>
    <p className="issue-detail-text">{issue.message}</p>
    {issue.attachment_count > 0 && <div className="issue-media stack">
      <div className="issue-attachment-head"><strong>Lampiran</strong><small>{issue.attachment_count} file</small></div>
      {mediaError && <Notice tone="error">{mediaError}</Notice>}
      {!media && !mediaError && <Loading label="Membuka lampiran…" />}
      {media?.filter(attachment => attachment.kind === 'image').length ? <ul className="issue-thumbnails">
        {media.filter(attachment => attachment.kind === 'image').map((attachment, index) => <li key={attachment.url}>
          <a href={attachment.url} target="_blank" rel="noopener noreferrer" aria-label={'Buka gambar ' + (index + 1)}>
            <img src={attachment.url} alt={'Gambar laporan ' + (index + 1)} loading="lazy" />
          </a>
        </li>)}
      </ul> : null}
      {media?.filter(attachment => attachment.kind === 'audio').map(attachment =>
        <audio key={attachment.url} src={attachment.url} controls preload="none" aria-label="Putar rekaman laporan" />)}
      {(media || mediaError) && <button type="button" className="button button-quiet issue-back" onClick={() => {
        setMedia(undefined); setMediaError(''); setRetry(value => value + 1)
      }}>Muat ulang lampiran</button>}
    </div>}
    <div className="issue-inbox-tools">
      <label>Status laporan
        <select value={nextStatus} onChange={event => { setNextStatus(event.target.value as IssueStatus); setNotice('') }} disabled={saving}>
          {Object.entries(issueStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="button" className="button button-primary" disabled={saving || nextStatus === issue.status}
        onClick={() => void saveStatus()}>{saving ? 'Menyimpan…' : 'Simpan status'}</button>
    </div>
    {statusError && <Notice tone="error">{statusError}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
  </section>
}
