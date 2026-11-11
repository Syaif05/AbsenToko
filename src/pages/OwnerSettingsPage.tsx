import { useEffect, useState } from 'react'
import { Dialog } from '../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../components/ui/shared'
import { loadBrand, resetAttendance, saveBrand } from '../features/owner/api'

export default function OwnerSettingsPage() {
  const [name, setName] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetId, setResetId] = useState<string>()
  const [confirmation, setConfirmation] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetMessage, setResetMessage] = useState('')

  async function performReset() {
    if (confirmation !== 'RESET' || resetBusy) return
    const id = resetId ?? crypto.randomUUID()
    setResetId(id)
    setResetBusy(true)
    setResetError('')
    try {
      let result = await resetAttendance(id, confirmation)
      while (!result.complete) result = await resetAttendance(id, confirmation)
      setResetMessage(result.deleted + ' catatan absensi dan foto terkait berhasil dibersihkan.')
      setResetId(undefined)
      setResetOpen(false)
      setConfirmation('')
    } catch (error) {
      setResetError(errorMessage(error, 'Reset belum selesai. Coba lagi.'))
    } finally {
      setResetBusy(false)
    }
  }

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
      <main className="narrow-shell stack">
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
        <section className="panel stack" aria-labelledby="attendance-reset-heading">
          <h2 id="attendance-reset-heading">Reset data absensi</h2>
          <p className="muted">
            Hapus semua catatan absensi, bukti, dan foto terkait. Data karyawan, toko, dan jadwal
            tetap tersedia.
          </p>
          {resetMessage && <Notice tone="success">{resetMessage}</Notice>}
          <button
            className="button button-danger"
            onClick={() => {
              setConfirmation('')
              setResetMessage('')
              setResetOpen(true)
            }}
          >
            {resetId ? 'Lanjutkan Reset Absensi' : 'Reset Data Absensi'}
          </button>
        </section>
      </main>
      {resetOpen && (
        <Dialog title="Reset data absensi" onClose={() => setResetOpen(false)} busy={resetBusy}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              void performReset()
            }}
          >
            <p>Tindakan ini menghapus permanen seluruh riwayat absensi, bukti, dan fotonya.</p>
            <label className="field">
              Ketik RESET untuk mengonfirmasi
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={resetBusy}
                required
              />
            </label>
            {resetError && <Notice tone="error">{resetError}</Notice>}
            <div className="directory-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={resetBusy}
                onClick={() => setResetOpen(false)}
              >
                Batal
              </button>
              <button
                type="submit"
                className="button button-danger"
                disabled={resetBusy || confirmation !== 'RESET'}
              >
                {resetBusy ? 'Menghapus…' : 'Hapus Data Absensi'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}
