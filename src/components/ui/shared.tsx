import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

export const appName = import.meta.env.VITE_APP_NAME?.trim() || 'Teh Idaman'

export function Header({ children }: { children?: ReactNode }) {
  const [name, setName] = useState(appName)
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim()
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
    const controller = new AbortController()
    let updated = false
    function onChange(event: Event) {
      updated = true
      setName((event as CustomEvent<string>).detail)
    }
    window.addEventListener('teh-idaman-brand', onChange)
    if (url && key) {
      void fetch(new URL('/rest/v1/app_brand?select=name&singleton=eq.true', url), {
        headers: { apikey: key }, signal: controller.signal,
      }).then(async response => {
        if (!response.ok) return
        const data = await response.json()
        if (!updated && !controller.signal.aborted && typeof data?.[0]?.name === 'string') setName(data[0].name)
      }).catch(() => { /* Use the default name if offline. */ })
    }
    return () => {
      controller.abort()
      window.removeEventListener('teh-idaman-brand', onChange)
    }
  }, [])
  useEffect(() => { document.title = name }, [name])
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/">
          <img className="brand-mark" src="/tea-mark.svg" width={40} height={40} alt="" />
          <span>{name}</span>
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

export function Loading({ label, variant = 'rows' }: { label: string; variant?: 'rows' | 'cards' | 'form' }) {
  return <div className={'loading loading-' + variant} role="status" aria-label={label}>
    <div className="loading-shapes" aria-hidden="true">{Array.from({ length: variant === 'cards' ? 4 : 3 }, (_, index) =>
      <div className="loading-item" key={index}><span className="loading-avatar" /><div><span className="loading-line" /><span className="loading-line loading-short" /></div></div>)}</div>
    <span className="muted">{label}</span>
  </div>
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
