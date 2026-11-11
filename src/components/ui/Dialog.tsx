import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

export function Dialog({ title, children, onClose, busy = false, className }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => {
    if (dialog.current) dialog.current.scrollTop = 0
    heading.current?.focus()
  }, [title])
  return (
    <dialog
      ref={dialog}
      className={className ? `sheet ${className}` : "sheet"}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}
    >
      <div className="sheet-heading">
        <h2 ref={heading} id={titleId} tabIndex={-1}>{title}</h2>
        <button type="button" className="button button-quiet sheet-close" onClick={onClose} disabled={busy} aria-label="Tutup dialog">×</button>
      </div>
      {children}
    </dialog>
  )
}
