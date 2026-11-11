import { useEffect, useState } from 'react'
import { Dialog } from '../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../components/ui/shared'
import { useOnline } from '../features/attendance/browser'
import type { Employee, Store } from '../features/attendance/types'
import {
  archiveEmployee,
  deleteStore,
  createEmployee,
  loadScheduleDirectory,
  renameEmployee,
  saveStore,
  setEmployeeActive,
} from '../features/owner/api'

type Editor =
  | { kind: 'edit'; id: string; existing: boolean }
  | { kind: 'delete'; item: Store }
  | { kind: 'toggle'; item: Employee }

export default function OwnerDirectoryPage({ mode }: { mode: 'employees' | 'stores' }) {
  const isStaff = mode === 'employees'
  const label = isStaff ? 'Karyawan' : 'Toko'
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof loadScheduleDirectory>>>()
  const [editor, setEditor] = useState<Editor>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const [storeId, setStoreId] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dialogError, setDialogError] = useState('')
  const [message, setMessage] = useState('')
  const online = useOnline()

  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    let current = true
    void loadScheduleDirectory(controller.signal).then(
      (data) => {
        if (current) {
          setDirectory(data)
          setError('')
        }
      },
      (error) => {
        if (current) setError(errorMessage(error, 'Daftar gagal dimuat.'))
      },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [online, revision])

  const stores = directory?.stores.filter((store) => !store.archivedAt) ?? []
  const employees = directory?.employees.filter((person) => !person.archivedAt) ?? []
  const storeNames = new Map(stores.map((store) => [store.id, store.name]))
  const counts = new Map<string, number>()
  for (const person of employees) {
    if (person.storeId) counts.set(person.storeId, (counts.get(person.storeId) ?? 0) + 1)
  }
  const matches = (value: string) =>
    value.toLocaleLowerCase('id').includes(query.trim().toLocaleLowerCase('id'))
  const people = employees.filter(
    (person) => matches(person.name) && (!filter || (person.storeId ?? 'none') === filter),
  )
  const shops = stores.filter((store) => matches(store.name))

  function edit(item?: Store, placement?: string | null) {
    setName(item?.name ?? '')
    setStoreId(placement ?? '')
    setDialogError('')
    setEditor({ kind: 'edit', id: item?.id ?? crypto.randomUUID(), existing: Boolean(item) })
  }

  async function save() {
    if (!editor || busy || !online) return
    setBusy(true)
    setDialogError('')
    setMessage('')
    try {
      if (editor.kind === 'delete') {
        await (isStaff ? archiveEmployee(editor.item.id) : deleteStore(editor.item.id))
        setMessage(isStaff ? 'Karyawan diarsipkan.' : 'Toko dihapus permanen.')
      } else if (editor.kind === 'toggle') {
        await setEmployeeActive(editor.item.id, !editor.item.active)
        setMessage('Status karyawan diperbarui.')
      } else {
        const trimmed = name.trim()
        if (!trimmed) return
        if (!isStaff) await saveStore(editor.id, trimmed, !editor.existing)
        else if (editor.existing) await renameEmployee(editor.id, trimmed, storeId || null)
        else await createEmployee(editor.id, trimmed, storeId || null)
        setMessage(label + ' disimpan.')
      }
      setEditor(undefined)
      setRevision((value) => value + 1)
    } catch (error) {
      setDialogError(errorMessage(error, 'Perubahan gagal disimpan.'))
    } finally {
      setBusy(false)
    }
  }

  function actions(item: Store, person?: Employee) {
    return (
      <div className="directory-actions">
        <button className="button button-secondary" onClick={() => edit(item, person?.storeId)}>
          Edit
        </button>
        {person && (
          <button
            className="button button-quiet"
            onClick={() => {
              setDialogError('')
              setEditor({ kind: 'toggle', item: person })
            }}
          >
            {person.active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        )}
        <button
          className="button button-danger"
          aria-label={(isStaff ? 'Arsipkan ' : 'Hapus ') + item.name}
          onClick={() => {
            setDialogError('')
            setEditor({ kind: 'delete', item })
          }}
        >
          {isStaff ? 'Arsipkan' : 'Hapus'}
        </button>
      </div>
    )
  }

  const title =
    editor?.kind === 'delete'
      ? (isStaff ? 'Arsipkan ' : 'Hapus Permanen ') + label
      : editor?.kind === 'toggle'
        ? editor.item.active
          ? 'Nonaktifkan Karyawan'
          : 'Aktifkan Karyawan'
        : (editor?.existing ? 'Edit ' : 'Tambah ') + label

  return (
    <>
      <main className="dashboard-shell stack">
        <section className="panel stack">
          <div className="directory-heading">
            <h1>Kelola {label}</h1>
            <button
              className="button button-primary"
              disabled={!directory || !online}
              onClick={() => edit()}
            >
              + Tambah {label}
            </button>
          </div>
          <div className="schedule-controls">
            <label className="field">
              Cari {label.toLocaleLowerCase('id')}
              <input
                type="search"
                value={query}
                placeholder="Cari nama"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {isStaff && (
              <label className="field">
                Toko
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="">Semua toko</option>
                  <option value="none">Belum ditempatkan</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {!online && <Notice tone="warning">Hubungkan internet untuk menyimpan perubahan.</Notice>}
          {error && (
            <>
              <Notice tone="error">{error}</Notice>
              <button
                className="button button-secondary"
                disabled={!online}
                onClick={() => setRevision((value) => value + 1)}
              >
                Coba Lagi
              </button>
            </>
          )}
          {message && <Notice tone="success">{message}</Notice>}
          {!directory && !error && online && (
            <Loading label={'Memuat ' + label.toLocaleLowerCase('id') + '…'} />
          )}
          {directory && (isStaff ? people.length : shops.length) === 0 && (
            <Notice>Tidak ada data yang cocok.</Notice>
          )}
          {directory && (
            <ul className="directory-list">
              {isStaff
                ? people.map((person) => (
                    <li key={person.id}>
                      <div>
                        <strong>{person.name}</strong>
                        <p className="muted">
                          {storeNames.get(person.storeId ?? '') ?? 'Belum ditempatkan'} ·{' '}
                          {person.active ? 'Aktif' : 'Nonaktif'}
                        </p>
                      </div>
                      {actions(person, person)}
                    </li>
                  ))
                : shops.map((store) => (
                    <li key={store.id}>
                      <div>
                        <strong>{store.name}</strong>
                        <p className="muted">{counts.get(store.id) ?? 0} karyawan terdaftar</p>
                      </div>
                      {actions(store)}
                    </li>
                  ))}
            </ul>
          )}
        </section>
      </main>
      {editor && (
        <Dialog title={title} onClose={() => setEditor(undefined)} busy={busy}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {dialogError && <Notice tone="error">{dialogError}</Notice>}
            {editor.kind === 'edit' ? (
              <>
                <label className="field">
                  Nama {label.toLocaleLowerCase('id')}
                  <input
                    required
                    maxLength={80}
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {isStaff && (
                  <label className="field">
                    Penempatan toko
                    <select
                      value={storeId}
                      disabled={busy}
                      onChange={(event) => setStoreId(event.target.value)}
                    >
                      <option value="">Belum ditempatkan</option>
                      {stores.map((store) => (
                        <option key={store.id} value={store.id}>
                          {store.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <>
                <p>
                  <strong>{editor.item.name}</strong>
                </p>
                {editor.kind === 'delete' && (
                  <p>
                    {isStaff
                      ? 'Karyawan diarsipkan. Riwayat absensi dan jadwal tetap tersedia.'
                      : 'Toko dan jadwalnya akan dihapus permanen. Catatan absensi dan buktinya tetap tersedia di rekap semua toko.'}
                  </p>
                )}
                {editor.kind === 'delete' && !isStaff && (counts.get(editor.item.id) ?? 0) > 0 && (
                  <Notice tone="warning">
                    Pindahkan atau hapus semua karyawan dari toko ini terlebih dahulu.
                  </Notice>
                )}
              </>
            )}
            <div className="directory-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setEditor(undefined)}
              >
                Batal
              </button>
              <button
                type="submit"
                className={
                  'button ' + (editor.kind === 'delete' ? 'button-danger' : 'button-primary')
                }
                disabled={
                  busy ||
                  !online ||
                  (editor.kind === 'edit' && !name.trim()) ||
                  (editor.kind === 'delete' && !isStaff && (counts.get(editor.item.id) ?? 0) > 0)
                }
              >
                {busy ? 'Menyimpan…' : editor.kind === 'edit' ? 'Simpan' : title}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}
