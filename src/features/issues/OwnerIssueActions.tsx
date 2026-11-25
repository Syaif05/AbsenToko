import { lazy, Suspense, useEffect, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading } from '../../components/ui/shared'
import { countNewIssues } from './api'
import { IssueLauncher } from './IssueLauncher'

const IssueInbox = lazy(() => import('./IssueInbox'))

export function OwnerIssueActions({ page }: { page: string }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let checking = false

    async function refresh() {
      if (document.hidden || checking) return
      checking = true
      try {
        const result = await countNewIssues(controller.signal)
        if (!controller.signal.aborted) setCount(result)
      } catch {
        // Retain the last confirmed count if a background refresh fails.
      } finally {
        checking = false
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 45_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [revision])

  function refreshCount() { setRevision(value => value + 1) }
  function close() { setOpen(false) }

  const hasNew = count !== null && count > 0
  const label = 'Kotak masuk laporan masalah' + (hasNew ? ' · ' + count + ' laporan baru' : '')

  return <>
    <button type="button" className="issue-launcher issue-inbox-launcher" title={label} aria-label={label}
      aria-haspopup="dialog" onClick={() => { setOpen(true); refreshCount() }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
        <path d="m4.5 7 7.5 6 7.5-6" />
      </svg>
      {hasNew && <span aria-hidden="true" className="issue-count">{count > 99 ? '99+' : count}</span>}
    </button>
    <IssueLauncher source={{ role: 'owner', page }} onSent={refreshCount} />
    {open && <Suspense fallback={<Dialog title="Laporan masalah" onClose={close}><Loading label="Membuka kotak masuk…" /></Dialog>}>
      <IssueInbox onClose={close} onStatusChanged={refreshCount} />
    </Suspense>}
  </>
}
