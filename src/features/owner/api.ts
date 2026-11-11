import { createClient } from '@supabase/supabase-js'
import type { Attendance, Employee, Evidence, Store } from '../attendance/types'

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
  if (error?.code === 'over_email_send_rate_limit') {
    throw new Error('Batas pengiriman email Supabase tercapai. Tunggu sebelum meminta tautan baru.')
  }
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') {
    throw new Error('Terlalu banyak permintaan reset. Tunggu sebelum mencoba lagi.')
  }
  if (error?.code === 'email_address_not_authorized') {
    throw new Error('Layanan email Supabase belum mengizinkan pengiriman ke alamat ini. Hubungi admin proyek.')
  }
  if (error) throw new Error('Permintaan reset belum berhasil. Coba lagi.')
}

export async function updateOwnerPassword(password: string) {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw new Error('Kata sandi belum bisa diperbarui. Gunakan tautan yang masih berlaku dan kata sandi baru.')
}

type EvidenceRow = { id: string; type: string; latitude: number; longitude: number; accuracy_m: number }
type AttendanceRow = {
  store_id: string | null
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

export async function loadDashboard(date: string, signal: AbortSignal): Promise<{ employees: Employee[]; records: Attendance[]; stores: Store[] }> {
  const [people, attendance, stores] = await Promise.all([
    client().from('employees').select('id,name,is_active,store_id,archived_at').order('name').abortSignal(signal),
    client().from('attendance').select('employee_id,store_id,work_date,check_in_at,check_out_at,attendance_evidence(id,type,latitude,longitude,accuracy_m)')
      .eq('work_date', date).abortSignal(signal),
    client().from('stores').select('id,name,archived_at').order('name').abortSignal(signal),
  ])
  if (people.error || attendance.error || stores.error) throw new Error('Rekap belum bisa dimuat. Coba lagi.')
  return {
    employees: people.data.map(row => ({ id: row.id, name: row.name, active: row.is_active, storeId: row.store_id, archivedAt: row.archived_at })),
    stores: stores.data.map(row => ({ id: row.id, name: row.name, archivedAt: row.archived_at })),
    records: (attendance.data as AttendanceRow[]).map(row => ({
      employeeId: row.employee_id, storeId: row.store_id,
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
export const createEmployee = (id: string, name: string, storeId: string | null) => invoke('create', id, { name, store_id: storeId })
export const renameEmployee = (id: string, name: string, storeId: string | null) => invoke('rename', id, { name, store_id: storeId })
export const setEmployeeActive = (id: string, active: boolean) => invoke(active ? 'activate' : 'deactivate', id)

export const saveStore = (id: string, name: string, creating: boolean) => invoke(creating ? 'create_store' : 'rename_store', id, { name })


export const archiveEmployee = (id: string) => invoke('archive_employee', id)
export const archiveStore = (id: string) => invoke('archive_store', id)

export async function loadScheduleDirectory() {
  const [people, stores] = await Promise.all([
    client().from('employees').select('id,name,is_active,store_id,archived_at').order('name'),
    client().from('stores').select('id,name,archived_at').order('name'),
  ])
  if (people.error || stores.error) throw new Error('Daftar toko dan karyawan belum bisa dimuat.')
  return {
    employees: people.data.map(row => ({ id: row.id, name: row.name, active: row.is_active, storeId: row.store_id, archivedAt: row.archived_at })),
    stores: stores.data.map(row => ({ id: row.id, name: row.name, archivedAt: row.archived_at } as Store)),
  }
}

export type ShiftCell = { employee_id: string; work_date: string; code: 'P' | 'M' | 'S' | 'O' }

export async function loadShifts(store: string, month: string, signal: AbortSignal): Promise<ShiftCell[]> {
  const [year, number] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10)
  const result: ShiftCell[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client().from('shift_schedule').select('employee_id,work_date,code')
      .eq('store_id', store).gte('work_date', month + '-01').lt('work_date', next)
      .order('work_date').order('employee_id').range(offset, offset + 499).abortSignal(signal)
    if (error) throw new Error('Jadwal belum bisa dimuat.')
    result.push(...data as ShiftCell[])
    if (data.length < 500) return result
  }
}

export async function importShifts(store: string, month: string, cells: ShiftCell[]) {
  const { data, error } = await client().rpc('owner_import_shifts', { p_store: store, p_month: month + '-01', p_cells: cells })
  if (error) throw new Error('Jadwal gagal disimpan. Periksa penempatan karyawan dan bulan yang dipilih.')
  return data as number
}

export async function saveBrand(name: string) {
  const { data, error } = await client().from('app_brand').update({ name }).eq('singleton', true).select('name').single()
  if (error) throw new Error('Nama aplikasi gagal disimpan.')
  return data.name as string
}

export async function loadBrand() {
  const { data, error } = await client().from('app_brand').select('name').eq('singleton', true).single()
  if (error) throw new Error('Pengaturan nama aplikasi gagal dimuat.')
  return data.name as string
}
