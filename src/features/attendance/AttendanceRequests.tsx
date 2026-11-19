import { useEffect, useRef, useState } from 'react'
import { employeeRequests, SessionEnded } from './api'
import type { Account } from './api'
import { todayWib, displayDate, displayTime } from './dates'
import type { AttendanceRequest } from './requests'
import { requestLabels } from './requests'
import { Notice, errorMessage } from '../../components/ui/shared'

export function AttendanceRequests({ account, onSessionEnded }: { account: Account; onSessionEnded: (message: string) => void }) {
  const [items,setItems] = useState<AttendanceRequest[]>([])
  const [date,setDate] = useState('')
  const [kind,setKind] = useState<'SHIFT'|'OUT'>('SHIFT')
  const [start,setStart] = useState('')
  const [end,setEnd] = useState('')
  const [reason,setReason] = useState('')
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const [busy,setBusy] = useState(false)
  const [revision,setRevision] = useState(0)
  const sending = useRef(false)
  const request = useRef<{key:string;id:string} | null>(null)
  const today = todayWib()
  const day = (offset:number) => new Date(Date.parse(today+'T12:00:00Z')-offset*86400000).toISOString().slice(0,10)
  useEffect(()=>{let active=true; void employeeRequests(account).then(data=>{if(active){setItems(data);setError('')}},cause=>{if(active){if(cause instanceof SessionEnded)onSessionEnded(cause.message);else setError(errorMessage(cause,'Pengajuan gagal dimuat.'))}});return()=>{active=false}},[account,revision,onSessionEnded])
  return <section className="panel stack">
    <div className="employee-section-heading"><h2>Lupa absen?</h2><button className="button button-quiet" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Perbarui</button></div>
    <p className="muted">Ajukan kehadiran 7 hari terakhir. Catatan resmi berubah setelah Owner menyetujui. Bukan absensi dengan foto/GPS saat kejadian.</p>
    <details><summary className="button button-secondary">Buat pengajuan</summary><form className="stack" onSubmit={async event=>{
      event.preventDefault(); if(sending.current)return
      const inDate = kind==='SHIFT' ? new Date(start+':00+07:00') : null
      const outDate = new Date(end+':00+07:00')
      if(!Number.isFinite(outDate.getTime()) || (inDate && !Number.isFinite(inDate.getTime())) || outDate.getTime()>Date.now() || (inDate && (todayWib(inDate)!==date || outDate<inDate))) { setError('Periksa tanggal kerja dan urutan jam masuk/pulang. Jam tidak boleh di masa depan.'); return }
      const checkin=inDate?.toISOString()??null
      const checkout=outDate.toISOString()
      const fields={date,kind,checkin,checkout,reason}
      const key=JSON.stringify(fields); if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
      sending.current=true;setBusy(true);setError('');setSuccess('')
      try{setItems(await employeeRequests(account,{...fields,id:request.current.id}));setSuccess('Pengajuan terkirim. Tunggu keputusan Owner.');setReason('');setStart('');setEnd('');request.current=null}
      catch(cause){if(cause instanceof SessionEnded)onSessionEnded(cause.message);else setError(errorMessage(cause,'Pengajuan belum tersimpan.'))}
      finally{sending.current=false;setBusy(false)}
    }}>
      <label className="field">Tanggal kerja (WIB)<input type="date" required min={day(7)} max={day(1)} value={date} disabled={busy} onChange={e=>setDate(e.target.value)} /></label>
      <label className="field">Yang terlupa<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as 'SHIFT'|'OUT')}><option value="SHIFT">Masuk dan pulang</option><option value="OUT">Pulang saja (masuk sudah tercatat)</option></select></label>
      {kind==='SHIFT'&&<label className="field">Tanggal dan jam masuk (WIB)<input type="datetime-local" required value={start} disabled={busy} onChange={e=>setStart(e.target.value)} /></label>}
      <label className="field">Tanggal dan jam pulang (WIB)<input type="datetime-local" required value={end} disabled={busy} onChange={e=>setEnd(e.target.value)} /></label>
      <label className="field">Alasan<textarea required minLength={5} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} /></label>
      <button className="button button-primary" disabled={busy}>{busy?'Mengirim…':'Ajukan ke Owner'}</button>
    </form></details>
    {error&&<Notice tone="error">{error}</Notice>}{success&&<Notice tone="success">{success}</Notice>}
    <h3>Pengajuan saya</h3><p className="muted">30 pengajuan terbaru</p>
    {!items.length&&<p>Belum ada pengajuan.</p>}
    {items.map(item=><article className="request-card stack" key={item.id}><strong>{displayDate(item.work_date)} · {requestLabels[item.status]}</strong><span>{item.kind==='SHIFT'?'Masuk & pulang':'Pulang saja'} · Pulang {displayTime(item.check_out_at)} WIB</span><p>{item.reason}</p>{item.review_note&&<p>Catatan Owner: {item.review_note}</p>}</article>)}
  </section>
}
