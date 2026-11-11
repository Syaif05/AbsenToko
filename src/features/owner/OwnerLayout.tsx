import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link, useLocation } from 'react-router'
import { appName, Notice, errorMessage } from '../../components/ui/shared'
import { loadBrand } from './api'
import { displayDate, todayWib } from '../attendance/dates'
import '../../styles/owner.css'

const links = [
  ['/owner', 'Ringkasan', '◫'],
  ['/owner/karyawan', 'Karyawan', '♙'],
  ['/owner/toko', 'Toko', '⌂'],
  ['/owner/jadwal', 'Jadwal', '▦'],
  ['/owner/pengaturan', 'Pengaturan', '⚙'],
]

export default function OwnerLayout({ onLogout }: { onLogout: () => Promise<void> }) {
  const [name, setName] = useState(appName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation()
  useEffect(() => {
    let current = true
    let changed = false
    void loadBrand()
      .then((value) => {
        if (current && !changed) setName(value)
      })
      .catch(() => {})
    const update = (event: Event) => {
      changed = true
      setName((event as CustomEvent<string>).detail)
    }
    window.addEventListener('teh-idaman-brand', update)
    return () => {
      current = false
      window.removeEventListener('teh-idaman-brand', update)
    }
  }, [])
  useEffect(() => {
    document.title = name + ' · Owner'
  }, [name])
  return (
    <div className="owner-app">
      <a className="owner-skip" href="#owner-content">
        Lewati navigasi
      </a>
      <aside className="owner-sidebar">
        <Link to="/owner" className="owner-brand">
          <span className="owner-mark" aria-hidden="true">
            ti
          </span>
          <span>
            {name}
            <small>Ruang Owner</small>
          </span>
        </Link>
        <p className="owner-nav-label">KELOLA USAHA</p>
        <nav aria-label="Navigasi Owner">
          {links.map(([to, label, icon]) => (
            <NavLink key={to} to={to} aria-label={label} end={to === '/owner'}>
              <span aria-hidden="true">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="owner-sidebar-bottom">
          <Link to="/" className="button button-secondary">
            Buka absensi ↗
          </Link>
          <button
            className="button button-quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await onLogout()
              } catch (cause) {
                setError(errorMessage(cause, 'Gagal keluar. Coba lagi.'))
                setBusy(false)
              }
            }}
          >
            {busy ? 'Keluar…' : 'Keluar akun'}
          </button>
        </div>
      </aside>
      <div className="owner-workspace">
        <header className="owner-topbar">
          <div>
            <small>Selamat datang kembali</small>
            <strong>{links.find(([to]) => to === location.pathname)?.[1] ?? 'Ruang Owner'}</strong>
          </div>
          <span className="owner-today">{displayDate(todayWib())} · WIB</span>
          <span className="owner-account" aria-label="Akun Owner">
            O
          </span>
        </header>
        {error && <Notice tone="error">{error}</Notice>}
        <div id="owner-content" tabIndex={-1}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
