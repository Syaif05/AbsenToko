import { useEffect, useRef, useState } from 'react'
import { TransferIcon } from '../components/ui/TransferIcon'
import { Loading, Notice, errorMessage } from '../components/ui/shared'
import { todayWib } from '../features/attendance/dates'
import { importShifts, loadScheduleDirectory, loadShifts } from '../features/owner/api'
import type { ShiftCell } from '../features/owner/api'
import {
  downloadSchedule,
  monthDays,
  readSchedule,
  shifts,
  validMonth,
} from '../features/owner/scheduleWorkbook'

export default function OwnerSchedulePage() {
  const uploadInput = useRef<HTMLInputElement>(null)
  const [directory, setDirectory] = useState<Awaited<ReturnType<typeof loadScheduleDirectory>>>()
  const [storeId, setStoreId] = useState('')
  const [month, setMonth] = useState(() => todayWib().slice(0, 7))
  const [snapshot, setSnapshot] = useState<{ scope: string; cells: ShiftCell[] }>()
  const [pending, setPending] = useState<ShiftCell[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [failedScope, setFailedScope] = useState('')
  const [retry, setRetry] = useState(0)
  const store = directory?.stores.find((item) => item.id === storeId)
  const scope = storeId + ':' + month
  const current = snapshot?.scope === scope
  const cells = current ? snapshot.cells : []
  const employees =
    directory?.employees.filter((person) => person.active && person.storeId === storeId) ?? []
  const historical = new Set(cells.map((cell) => cell.employee_id))
  const shown =
    directory?.employees.filter(
      (person) => (person.active && person.storeId === storeId) || historical.has(person.id),
    ) ?? []
  const days = validMonth(month) ? monthDays(month) : []
  const preview = new Map(
    [...cells, ...pending].map((cell) => [cell.employee_id + ':' + cell.work_date, cell.code]),
  )

  useEffect(() => {
    let active = true
    void loadScheduleDirectory().then(
      (data) => {
        if (!active) return
        setDirectory(data)
        setStoreId(
          (previous) =>
            previous ||
            data.stores.find((store) => !store.archivedAt)?.id ||
            data.stores[0]?.id ||
            '',
        )
      },
      (error) => {
        if (active) setError(errorMessage(error, 'Daftar toko belum tersedia.'))
      },
    )
    return () => {
      active = false
    }
  }, [retry])

  useEffect(() => {
    if (!storeId || !validMonth(month)) return
    const controller = new AbortController()
    void loadShifts(storeId, month, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setSnapshot({ scope, cells: data })
          setFailedScope('')
          setError('')
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(error, 'Jadwal belum tersedia.'))
          setFailedScope(scope)
        }
      },
    )
    return () => controller.abort()
  }, [storeId, month, scope, retry])

  async function run(action: () => Promise<void>) {
    if (!store || busy || !current) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (error) {
      setError(errorMessage(error, 'Operasi jadwal gagal. Coba lagi.'))
    } finally {
      setBusy(false)
    }
  }

  function resetPreview() {
    setPending([])
    setError('')
    setMessage('')
    setFailedScope('')
  }

  return (
    <>
      <main className="dashboard-shell stack">
        <section className="panel stack">
          <h1>Jadwal Karyawan</h1>
          <div className="schedule-controls">
            <label className="field">
              Toko
              <select
                value={storeId}
                disabled={busy || !directory}
                onChange={(event) => {
                  resetPreview()
                  setStoreId(event.target.value)
                }}
              >
                {!directory?.stores.length && <option value="">Belum ada toko</option>}
                {directory?.stores.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.archivedAt ? ' (arsip)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Bulan
              <input
                type="month"
                value={month}
                min="2000-01"
                max="2099-12"
                disabled={busy}
                onChange={(event) => {
                  resetPreview()
                  setMonth(event.target.value)
                }}
              />
            </label>
          </div>
          <div className="manage-actions">
            <button
              className="button button-secondary"
              disabled={busy || !current || !employees.length || !!store?.archivedAt}
              onClick={() => {
                if (store) void run(() => downloadSchedule(store, month, employees, cells))
              }}
            >
              <TransferIcon direction="down" /> Unduh Template Excel
            </button>
            <button
              className="button button-primary"
              disabled={busy || !current || !employees.length || !!store?.archivedAt}
              onClick={() => uploadInput.current?.click()}
            >
              <TransferIcon direction="up" /> Unggah Jadwal
            </button>
            <input
              ref={uploadInput}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file && store) {
                  setPending([])
                  void run(async () =>
                    setPending(await readSchedule(file, store, month, employees)),
                  )
                }
              }}
            />
          </div>
          <p className="muted">
            Lihat tab Contoh Pengisian, lalu isi tab Jadwal di Excel atau Google Sheets. Unggah file
            .xlsx untuk melihat pratinjau.
          </p>
          {error && (
            <>
              <Notice tone="error">{error}</Notice>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setError('')
                  setFailedScope('')
                  setRetry((value) => value + 1)
                }}
              >
                Coba Lagi
              </button>
            </>
          )}
          {message && <Notice tone="success">{message}</Notice>}
          {pending.length > 0 && (
            <div className="stack">
              <Notice>
                Pratinjau {pending.length} sel dari file. Sel kosong mempertahankan jadwal yang
                sudah tersimpan.
              </Notice>
              <div className="schedule-controls">
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => {
                    if (!store) return
                    void run(async () => {
                      const count = await importShifts(store.id, month, pending)
                      const merged = new Map(
                        cells.map((cell) => [cell.employee_id + ':' + cell.work_date, cell]),
                      )
                      for (const cell of pending)
                        merged.set(cell.employee_id + ':' + cell.work_date, cell)
                      setSnapshot({ scope, cells: [...merged.values()] })
                      setPending([])
                      setMessage(count + ' sel jadwal disimpan.')
                    })
                  }}
                >
                  Simpan Jadwal
                </button>
                <button className="button button-quiet" disabled={busy} onClick={resetPreview}>
                  Batalkan Pratinjau
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="panel stack">
          <p className="muted">
            {Object.entries(shifts)
              .map(([code, label]) => code + ' = ' + label)
              .join('  •  ')}
          </p>
          {store && days.length > 0 && !current && failedScope !== scope && (
            <Loading label="Memuat jadwal…" />
          )}
          {current && shown.length === 0 && <Notice>Belum ada karyawan di toko ini.</Notice>}
          {current && shown.length > 0 && (
            <div
              className="schedule-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabel jadwal bulanan"
            >
              <table className="schedule-table">
                <caption className="sr-only">
                  {store?.name} · {month}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Karyawan</th>
                    {days.map((day) => (
                      <th scope="col" key={day}>
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((person) => (
                    <tr key={person.id}>
                      <th scope="row">{person.name}</th>
                      {days.map((day) => {
                        const code = preview.get(
                          person.id + ':' + month + '-' + String(day).padStart(2, '0'),
                        )
                        return (
                          <td key={day} data-shift={code} title={code && shifts[code]}>
                            {code ?? '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {Object.entries(shifts)
                    .filter(([code]) => code !== 'O')
                    .map(([code, label]) => (
                      <tr key={code}>
                        <th scope="row">{label.split(' · ')[0]}</th>
                        {days.map((day) => (
                          <td key={day}>
                            {
                              shown.filter(
                                (person) =>
                                  preview.get(
                                    person.id + ':' + month + '-' + String(day).padStart(2, '0'),
                                  ) === code,
                              ).length
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  )
}
