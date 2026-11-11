import { useEffect, useState } from 'react'
import { Loading, Notice, errorMessage } from '../components/ui/shared'
import { loadBrand, saveBrand } from '../features/owner/api'

export default function OwnerSettingsPage() {
  const [name, setName] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    void loadBrand().then(
      (value) => {
        if (current) setName(value)
      },
      (error) => {
        if (current) setError(errorMessage(error, 'Pengaturan belum bisa dimuat.'))
      },
    )
    return () => {
      current = false
    }
  }, [retry])
  return (
    <>
      <main className="narrow-shell">
        <section className="panel stack">
          <h1>Pengaturan</h1>
          {error && (
            <>
              <Notice tone="error">{error}</Notice>
              {name === undefined && (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setError('')
                    setRetry((value) => value + 1)
                  }}
                >
                  Coba Lagi
                </button>
              )}
            </>
          )}
          {saved && <Notice tone="success">Nama aplikasi diperbarui.</Notice>}
          {name === undefined ? (
            !error && <Loading label="Memuat pengaturan…" />
          ) : (
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault()
                if (busy || !name.trim()) return
                setBusy(true)
                setError('')
                setSaved(false)
                try {
                  const value = await saveBrand(name.trim())
                  setName(value)
                  window.dispatchEvent(new CustomEvent('teh-idaman-brand', { detail: value }))
                  setSaved(true)
                } catch (error) {
                  setError(errorMessage(error, 'Nama aplikasi gagal disimpan.'))
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label className="field">
                Nama aplikasi
                <input
                  value={name}
                  maxLength={60}
                  required
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.target.value)
                    setSaved(false)
                  }}
                />
              </label>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !name.trim()}
              >
                {busy ? 'Menyimpan…' : 'Simpan Nama'}
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  )
}
