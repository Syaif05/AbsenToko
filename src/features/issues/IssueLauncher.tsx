import { lazy, Suspense, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading } from '../../components/ui/shared'
import type { IssueSource } from './api'
import './issues.css'

const IssueDialog = lazy(() => import('./IssueDialog'))

export function IssueLauncher({ source, onSent }: { source: IssueSource; onSent?: () => void }) {
  const [open, setOpen] = useState(false)
  const label = 'Laporkan masalah'
  function close() { setOpen(false) }

  return <>
    <button type="button" className="issue-launcher" title={label} aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3.5h12A2.5 2.5 0 0 1 20.5 6v8A2.5 2.5 0 0 1 18 16.5h-7l-5 4v-4A2.5 2.5 0 0 1 3.5 14V6A2.5 2.5 0 0 1 6 3.5Z"/>
        <path d="M12 7v3.5m0 2.75h.01"/>
      </svg>
    </button>
    {open && <Suspense fallback={<Dialog title={label} onClose={close}><Loading label="Membuka laporan masalah…" /></Dialog>}>
      <IssueDialog source={source} onClose={close} onSent={onSent} />
    </Suspense>}
  </>
}
