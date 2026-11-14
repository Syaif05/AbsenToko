import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { Loading, Notice, errorMessage } from '../../components/ui/shared'
import { loadReportRecords } from './api'
import { exportReport, reportRows } from './report'
import type { ReportFormat } from './report'
import { periodRange, validRange } from './reportPeriod'
import type { Employee, Store } from '../attendance/types'

export default function ReportDownload({ date, employees, stores, onClose }: {
  date: string; employees: Employee[]; stores: Store[]; onClose: () => void
}) {
  const [period, setPeriod] = useState('day')
  const [start, setStart] = useState(date)
  const [end, setEnd] = useState(date)
  const [store, setStore] = useState('')
  const [employee, setEmployee] = useState('')
  const [format, setFormat] = useState<ReportFormat>('xlsx')
  const [rows, setRows] = useState<ReturnType<typeof reportRows> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [])
  const invalidate = () => { setRows(null); setError('') }
  async function prepare() {
    if (!validRange(start, end) || busy) return
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    const timer = setTimeout(() => request.abort(), 120000)
    setBusy(true); setError(''); setRows(null)
    try {
      const records = await loadReportRecords(start, end, request.signal)
      const people = new Map(employees.map(person => [person.id, person]))
      const next = records.filter(record => (!store || (store === 'unassigned' ? !record.storeId : record.storeId === store)) && (!employee || record.employeeId === employee))
        .flatMap(record => reportRows([people.get(record.employeeId) ?? { id: record.employeeId, name: 'Karyawan tidak tersedia', active: false }], [record], stores, record.workDate))
      if (!request.signal.aborted) setRows(next)
    } catch (cause) {
      if (controller.current === request) setError(request.signal.aborted ? 'Pemuatan terlalu lama. Pilih periode lebih pendek lalu coba lagi.' : errorMessage(cause, 'Laporan gagal dimuat.'))
    } finally { clearTimeout(timer); if (controller.current === request) setBusy(false) }
  }
  return <Dialog title="Unduh laporan absensi" onClose={onClose}>
    <div className="stack report-download">
      <p className="muted">Catatan kehadiran aktual, maksimal satu tahun per unduhan. Tanggal mengikuti WIB. Durasi adalah selisih masuk–pulang, bukan perhitungan gaji.</p>
      <label className="field">Periode cepat<select value={period} disabled={busy} onChange={event => {
        setPeriod(event.target.value)
        if (event.target.value !== 'custom') { const [a, b] = periodRange(event.target.value, date); setStart(a); setEnd(b) }
        invalidate()
      }}><option value="day">Tanggal terpilih</option><option value="week">Minggu tanggal terpilih (Senin–Minggu)</option><option value="month">Bulan tanggal terpilih</option><option value="year">Tahun tanggal terpilih</option><option value="custom">Tanggal bebas</option></select></label>
      <div className="report-date-range">
        <label className="field">Dari tanggal<input type="date" value={start} disabled={busy} onChange={event => { setStart(event.target.value); setPeriod('custom'); invalidate() }} /></label>
        <label className="field">Sampai tanggal<input type="date" value={end} disabled={busy} onChange={event => { setEnd(event.target.value); setPeriod('custom'); invalidate() }} /></label>
      </div>
      {!validRange(start,end) && <Notice tone="warning">Pilih tanggal yang valid dan berurutan, maksimal 366 hari.</Notice>}
      <label className="field">Toko<select value={store} disabled={busy} onChange={event => { setStore(event.target.value); invalidate() }}><option value="">Semua toko</option><option value="unassigned">Toko historis belum tercatat</option>{stores.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field">Karyawan<select value={employee} disabled={busy} onChange={event => { setEmployee(event.target.value); invalidate() }}><option value="">Semua karyawan</option>{employees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {error && <Notice tone="error">{error}</Notice>}
      {busy && <Loading label="Menyiapkan catatan kehadiran…" />}
      <button className="button button-secondary" disabled={busy || !validRange(start,end)} onClick={prepare}>{busy ? 'Memuat…' : 'Siapkan laporan'}</button>
      {rows && <><Notice>{rows.length} catatan ditemukan · {start} sampai {end}.</Notice>
        <label className="field">Format<select value={format} onChange={event => setFormat(event.target.value as ReportFormat)}><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="json">JSON</option><option value="print">PDF / Cetak</option></select></label>
        <button className="button button-primary" disabled={busy || !rows.length} onClick={async () => {
          setBusy(true); setError('')
          try { await exportReport(format, rows, start + '_sampai_' + end, stores.find(item => item.id === store)?.name ?? (store ? 'Toko historis' : 'Semua toko')) }
          catch (cause) { setError(errorMessage(cause, 'Unduhan gagal.')) }
          finally { setBusy(false) }
        }}>{busy ? 'Menyiapkan file…' : 'Unduh ' + rows.length + ' catatan'}</button>
      </>}
    </div>
  </Dialog>
}
