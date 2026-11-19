import { useEffect, useRef, useState } from 'react'
import { loadAttendanceRequests, reviewAttendanceRequest } from './api'
import type { AttendanceRequest } from '../attendance/requests'
import type { Employee } from '../attendance/types'
import { displayDate, displayTime, todayWib } from '../attendance/dates'
import { Notice, errorMessage } from '../../components/ui/shared'
function RequestReview({item,name,onSaved}:{item:AttendanceRequest;name:string;onSaved:()=>void}) {
  const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  const sending=useRef(false)
  async function review(approve:boolean){if(busy||sending.current)return;sending.current=true;setBusy(true);setError('');try{await reviewAttendanceRequest(item.id,approve,note);onSaved()}catch(cause){setError(errorMessage(cause,'Gagal menyimpan keputusan.'))}finally{sending.current=false;setBusy(false)}}
  const time=(value:string)=>displayDate(todayWib(new Date(value)))+' · '+displayTime(value)+' WIB'
  return <article className="request-card stack"><h3>{name} · {displayDate(item.work_date)}</h3><p>{item.kind==='SHIFT'?'Masuk dan pulang':'Pulang saja'}</p>{item.check_in_at&&<p>Masuk: {time(item.check_in_at)}</p>}<p>Pulang: {time(item.check_out_at)}</p><p>Alasan: {item.reason}</p><label className="field">Catatan keputusan<textarea minLength={5} maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} /></label><div className="owner-export"><button className="button button-primary" disabled={busy||note.trim().length<5} onClick={()=>review(true)}>Setujui</button><button className="button button-secondary" disabled={busy||note.trim().length<5} onClick={()=>review(false)}>Tolak</button></div>{error&&<Notice tone="error">{error}</Notice>}</article>
}
export function AttendanceRequestQueue({employees,onSaved}:{employees:Employee[];onSaved:()=>void}) {
 const [items,setItems]=useState<AttendanceRequest[]>([]);const [revision,setRevision]=useState(0);const [error,setError]=useState('')
 useEffect(()=>{const c=new AbortController();void loadAttendanceRequests(AbortSignal.any([c.signal,AbortSignal.timeout(30000)])).then(data=>{if(!c.signal.aborted){setItems(data);setError('')}},cause=>{if(!c.signal.aborted)setError(errorMessage(cause,'Gagal memuat pengajuan.'))});return()=>c.abort()},[revision])
 return <section className="panel stack"><div className="employee-section-heading"><h2>Pengajuan kehadiran</h2><button className="button button-secondary" onClick={()=>setRevision(v=>v+1)}>Perbarui pengajuan</button></div><p className="muted">Maksimal 100 pengajuan tertua yang menunggu. Persetujuan membuat catatan manual tanpa bukti kamera/GPS.</p>{error&&<Notice tone="error">{error}</Notice>}{!items.length&&!error&&<p>Tidak ada pengajuan menunggu.</p>}{items.map(item=><RequestReview key={item.id} item={item} name={employees.find(p=>p.id===item.employee_id)?.name??'Karyawan'} onSaved={()=>{setRevision(v=>v+1);onSaved()}} />)}</section>
}
