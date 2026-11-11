import type { ReactNode } from 'react'
import { Link } from 'react-router'

export const appName = import.meta.env.VITE_APP_NAME?.trim() || 'Absen Toko'

export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>{appName}</span>
        </Link>
        {children}
      </div>
    </header>
  )
}

export function Notice({ children, tone = 'info' }: {
  children: ReactNode; tone?: 'info' | 'error' | 'warning' | 'success'
}) {
  return <p className={'notice notice-' + tone} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="loading" role="status">
      <span className="skeleton" aria-hidden="true" />
      <span className="skeleton" aria-hidden="true" />
      <span className="muted">{label}</span>
    </div>
  )
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
