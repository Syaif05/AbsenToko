import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Header, Notice, errorMessage } from '../components/ui/shared'
import { useOnline } from '../features/attendance/browser'
import { requestPasswordReset, signInOwner, updateOwnerPassword } from '../features/owner/api'

export default function OwnerLoginPage({ recovery = false, invalidRecovery = false }: { recovery?: boolean; invalidRecovery?: boolean }) {
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const online = useOnline()
  const resetting = mode === 'reset'
  const navigate = useNavigate()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!online || busy) return
    setBusy(true)
    setError('')
    setDone(false)
    try {
      if (recovery) {
        await updateOwnerPassword(password)
        navigate('/owner', { replace: true })
      } else if (resetting) {
        await requestPasswordReset(email)
        setDone(true)
      } else {
        await signInOwner(email, password)
      }
    } catch (error) {
      setError(errorMessage(error, 'Permintaan belum berhasil. Coba lagi.'))
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(resetting ? 'login' : 'reset')
    setPassword('')
    setError('')
    setDone(false)
  }

  return (
    <>
      <Header><Link className="button header-link" to="/">Absensi Karyawan</Link></Header>
      <main className="narrow-shell">
        <div className="page-intro">
          <h1>{recovery ? 'Buat kata sandi baru' : resetting ? 'Reset kata sandi' : 'Masuk Owner'}</h1>
          <p className="muted">{resetting ? 'Masukkan email akun Owner.' : 'Lihat rekap absensi dan kelola karyawan.'}</p>
        </div>
        {!online && <Notice tone="warning">Periksa koneksi internet untuk melanjutkan.</Notice>}
        {invalidRecovery && <Notice tone="warning">Tautan reset tidak bisa digunakan. Minta tautan baru jika diperlukan.</Notice>}
        <form className="panel stack" onSubmit={submit}>
          {!recovery && <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy}
              onChange={(event) => { setEmail(event.target.value); setError(''); setDone(false) }} />
          </label>}
          {!resetting && (
            <label className="field">
              <span>Kata sandi</span>
              <input type="password" autoComplete={recovery ? "new-password" : "current-password"} required minLength={recovery ? 8 : undefined} maxLength={128} placeholder={recovery ? "Minimal 8 karakter" : undefined}
                value={password} disabled={busy} onChange={(event) => { setPassword(event.target.value); setError('') }} />
            </label>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {done && <Notice tone="success">Jika akun terdaftar, tautan reset akan dikirim ke email tersebut.</Notice>}
          <button className="button button-primary w-full" type="submit" disabled={!online || busy}>
            {busy ? 'Memproses…' : recovery ? 'Simpan Kata Sandi' : resetting ? 'Kirim Tautan Reset' : 'Masuk'}
          </button>
          {!recovery && <button className="button button-quiet w-full" type="button" onClick={switchMode} disabled={busy}>
            {resetting ? 'Kembali ke Login' : 'Lupa kata sandi?'}
          </button>}
        </form>
      </main>
    </>
  )
}
