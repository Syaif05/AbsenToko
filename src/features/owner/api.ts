import { createClient } from '@supabase/supabase-js'
import type { Attendance, Employee, Evidence } from '../attendance/types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const ownerClient = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null

function client() {
  if (!ownerClient) throw new Error('Konfigurasi Supabase belum tersedia.')
  return ownerClient
}

export async function isOwner(id: string) {
  const { data, error } = await client().from('owner_profiles').select('user_id')
    .eq('user_id', id).eq('role', 'owner').maybeSingle()
  if (error) throw new Error('Hak akses Owner belum bisa diperiksa.')
  return Boolean(data)
}

export async function signInOwner(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error('Email atau kata sandi tidak dapat diverifikasi.')
}

export async function requestPasswordReset(email: string) {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: new URL('/owner/reset', window.location.origin).href,
  })
  if (error) throw new Error('Permintaan reset belum berhasil. Coba lagi.')
}

export async function updateOwnerPassword(password: string) {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw new Error('Kata sandi belum bisa diperbarui. Gunakan tautan yang masih berlaku dan kata sandi baru.')
}

type EvidenceRow = { id: string; type: string; latitude: number; longitude: number; accuracy_m: number }
type AttendanceRow = {
  employee_id: string; work_date: string; check_in_at: string; check_out_at: string | null
  attendance_evidence: EvidenceRow[]
}

function readEvidence(at: string, row?: EvidenceRow): Evidence {
  return {
    at, photo: null, id: row?.id,
    location: row ? { latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy_m }
      : undefined,
  }
}

export async function loadDashboard(date: string, signal: AbortSignal): Promise<{ employees: Employee[]; records: Attendance[] }> {
  const [people, attendance] = await Promise.all([
    client().from('employees').select('id,name,is_active').order('name').abortSignal(signal),
    client().from('attendance').select('employee_id,work_date,check_in_at,check_out_at,attendance_evidence(id,type,latitude,longitude,accuracy_m)')
      .eq('work_date', date).abortSignal(signal),
  ])
  if (people.error || attendance.error) throw new Error('Rekap belum bisa dimuat. Coba lagi.')
  return {
    employees: people.data.map(row => ({ id: row.id, name: row.name, active: row.is_active })),
    records: (attendance.data as AttendanceRow[]).map(row => ({
      employeeId: row.employee_id,
      workDate: row.work_date,
      checkIn: readEvidence(row.check_in_at, row.attendance_evidence.find(item => item.type === 'IN')),
      checkOut: row.check_out_at ? readEvidence(row.check_out_at, row.attendance_evidence.find(item => item.type === 'OUT')) : undefined,
    })),
  }
}

async function invoke<T>(operation: string, id: string, fields = {}, signal?: AbortSignal): Promise<T> {
  const { data: { session } } = await client().auth.getSession()
  if (!session) throw new Error('Sesi berakhir. Silakan masuk kembali.')
  const response = await fetch(new URL('/functions/v1/owner-api', url), {
    method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', apikey: key!, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ operation, id, ...fields }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? 'Layanan Owner belum tersedia.')
  return data as T
}

export const getPrivatePhoto = (id: string, signal: AbortSignal) => invoke<{ url: string }>('photo', id, {}, signal)
export const createEmployee = (id: string, name: string) => invoke<{ pin: string }>('create', id, { name })
export const renameEmployee = (id: string, name: string) => invoke('rename', id, { name })
export const setEmployeeActive = (id: string, active: boolean) => invoke(active ? 'activate' : 'deactivate', id)
export const resetEmployeePin = (id: string) => invoke<{ pin: string }>('reset_pin', id)
