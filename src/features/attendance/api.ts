import * as demo from '../demo/store'
import type { Action, AttendanceStatus, Employee, Location } from './types'

export const demoMode = import.meta.env.VITE_ATTENDANCE_MODE === 'demo'
export type Session = { employee: Employee; status: AttendanceStatus; token?: string; expiresAt?: number }
type Receipt = { action: Action; recorded_at: string }
type StatusResponse = {
  status: AttendanceStatus['kind']
  attendance: { employee_id: string; work_date: string; check_in_at: string; check_out_at: string | null } | null
}

async function call<T>(operation: string, fields = {}, token?: string): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) throw new Error('Konfigurasi absensi belum tersedia. Hubungi Owner.')
  const headers = new Headers({ 'content-type': 'application/json', apikey: key })
  if (token) headers.set('Authorization', 'Bearer ' + token)
  const response = await fetch(new URL('/functions/v1/attendance-api', url), {
    method: 'POST', headers, body: JSON.stringify({ operation, ...fields }),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new Error('Koneksi ke layanan absensi terputus. Coba lagi.') })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result) {
    throw new Error(typeof result?.error === 'string' ? result.error : 'Layanan absensi belum tersedia.')
  }
  return result as T
}

function readStatus({ status, attendance }: StatusResponse): AttendanceStatus {
  if (status === 'NOT_CHECKED_IN') return { kind: status }
  if (!attendance || !['CHECKED_IN', 'COMPLETED', 'EXPIRED'].includes(status)) {
    throw new Error('Status absensi tidak tersedia.')
  }
  return {
    kind: status,
    record: { employeeId: attendance.employee_id, workDate: attendance.work_date,
      checkIn: { at: attendance.check_in_at },
      checkOut: attendance.check_out_at ? { at: attendance.check_out_at } : undefined },
  }
}

export async function listEmployees(): Promise<Employee[]> {
  if (demoMode) return demo.listActiveEmployees()
  const { employees } = await call<{ employees: Pick<Employee, 'id' | 'name'>[] }>('list')
  return employees.map(employee => ({ ...employee, active: true }))
}

export async function verifyEmployee(employee: Employee, pin: string): Promise<Session> {
  if (demoMode) return demo.verifyPin(employee.id, pin)
  const result = await call<StatusResponse & { token: string; expires_at: string }>('verify', { employee_id: employee.id, pin })
  const expiresAt = Date.parse(result.expires_at)
  if (!/^[0-9a-f]{64}$/.test(result.token) || !Number.isFinite(expiresAt)) throw new Error('Sesi absensi tidak valid.')
  return { employee, status: readStatus(result), token: result.token, expiresAt }
}

export async function refreshStatus(session: Session) {
  if (demoMode) return demo.statusFor(session.employee.id)
  return readStatus(await call<StatusResponse>('status', {}, session.token))
}

async function photoBase64(photo: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Foto belum bisa dibaca.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(photo)
  })
}

export type Attempt = { attemptId: string; action: Action; photo: Blob; location: Location }
function checkedReceipt(receipt: Receipt, action: Action): Receipt {
  if (!receipt || receipt.action !== action || !Number.isFinite(Date.parse(receipt.recorded_at))) {
    throw new Error('Hasil absensi belum dapat dikonfirmasi.')
  }
  return receipt
}

export async function findReceipt(session: Session, { attemptId, action }: Attempt) {
  if (demoMode) return null
  const { receipt } = await call<{ receipt: Receipt | null }>('receipt', { attempt_id: attemptId }, session.token)
  return receipt === null ? null : checkedReceipt(receipt, action)
}

export async function prepareEvidence(session: Session, { attemptId, action }: Attempt) {
  if (!demoMode) await call('prepare', { attempt_id: attemptId, action }, session.token)
}

export async function submitEvidence(session: Session, attempt: Attempt): Promise<Receipt> {
  if (demoMode) {
    const result = await demo.submitAttendance({ employeeId: session.employee.id, ...attempt })
    return { action: attempt.action, recorded_at: result.at }
  }
  const { attemptId, photo, location } = attempt
  const receipt = await call<Receipt>('submit', { attempt_id: attemptId, photo: await photoBase64(photo),
    latitude: location.latitude, longitude: location.longitude, accuracy_m: location.accuracy }, session.token)
  return checkedReceipt(receipt, attempt.action)
}
