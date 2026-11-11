import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Header, Loading, Notice } from '../../components/ui/shared'
import OwnerDashboardPage from '../../pages/OwnerDashboardPage'
import OwnerLoginPage from '../../pages/OwnerLoginPage'
import { isOwner, ownerClient } from './api'

export default function OwnerRoutes() {
  const [uid, setUid] = useState<string | null | undefined>(undefined)
  const [access, setAccess] = useState<{ uid: string; allowed: boolean; error?: string }>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const listener = ownerClient?.auth.onAuthStateChange((_event, session) => {
      if (!session) setAccess(undefined)
      setUid(session?.user.id ?? null)
    })
    return () => listener?.data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!uid) return
    let active = true
    void isOwner(uid).then(allowed => {
      if (active) setAccess({ uid, allowed })
    }, () => {
      if (active) setAccess({ uid, allowed: false, error: 'Hak akses belum bisa diperiksa.' })
    })
    return () => { active = false }
  }, [uid, retry])

  if (ownerClient && (uid === undefined || (uid && access?.uid !== uid))) {
    return <><Header /><main className="narrow-shell"><Loading label="Memeriksa sesi Owner…" /></main></>
  }

  const allowed = Boolean(uid && access?.uid === uid && access.allowed)
  async function logout() {
    const result = await ownerClient?.auth.signOut({ scope: 'local' })
    if (result?.error) throw new Error('Belum bisa keluar. Coba lagi.')
    setUid(null)
  }

  if (uid && !allowed) {
    return <><Header /><main className="narrow-shell panel stack">
      <Notice tone="error">{access?.error ?? 'Akun ini belum memiliki akses Owner.'}</Notice>
      {access?.error && <button className="button button-primary" onClick={() => setRetry(value => value + 1)}>Coba Lagi</button>}
      <button className="button button-secondary" onClick={() => void logout().catch(() => {
        setAccess({ uid, allowed: false, error: 'Belum bisa keluar. Coba lagi.' })
      })}>Keluar</button>
    </main></>
  }

  return (
    <Routes>
      <Route index element={allowed ? <OwnerDashboardPage key={uid} onLogout={logout} /> : <Navigate replace to="/owner/login" />} />
      <Route path="login" element={allowed ? <Navigate replace to="/owner" /> : <OwnerLoginPage />} />
      <Route path="reset" element={allowed ? <OwnerLoginPage recovery /> : <OwnerLoginPage invalidRecovery />} />
      <Route path="*" element={<Navigate replace to="/owner" />} />
    </Routes>
  )
}
