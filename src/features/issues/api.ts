import { ownerClient } from '../owner/api'

export type IssueSource = { role: 'employee'; token: string; page: '/' } | { role: 'owner'; page: string }
export const issueStatus = { new: 'Baru', reviewing: 'Ditinjau', resolved: 'Selesai' }
export type IssueStatus = keyof typeof issueStatus
export type Issue = {
  id: string; reporter_role: 'employee' | 'owner'; reporter_name: string; page: string
  message: string; attachment_count: number; status: IssueStatus; created_at: string
}
export type IssueAttachment = { kind: 'image' | 'audio'; url: string }
export const maxImages = 5
export const imageBytes = 4 * 1024 * 1024
export const audioBytes = 3 * 1024 * 1024
export const descriptionLimit = 12000
export const pageSize = 15

export const issuePages: Record<string, string> = {
  '/': 'Portal Karyawan',
  '/owner': 'Ringkasan Owner',
  '/owner/karyawan': 'Kelola karyawan',
  '/owner/toko': 'Kelola toko',
  '/owner/jadwal': 'Jadwal karyawan',
  '/owner/stock-opname': 'Manajemen & Laporan SO',
  '/owner/pengaturan': 'Pengaturan Owner',
}

async function issueCall<T>(body: FormData | Record<string, unknown>, source: IssueSource, signal?: AbortSignal): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) throw new Error('Layanan laporan belum dikonfigurasi.')
  const token = source.role === 'employee' ? source.token : (await ownerClient?.auth.getSession())?.data.session?.access_token
  if (!token) throw new Error('Sesi berakhir. Masuk kembali untuk menggunakan laporan masalah.')

  const headers = new Headers({ apikey: key, Authorization: 'Bearer ' + token })
  const multipart = body instanceof FormData
  if (!multipart) headers.set('content-type', 'application/json')
  const timeout = AbortSignal.timeout(multipart ? 120_000 : 25_000)
  const response = await fetch(new URL('/functions/v1/issue-reports', url), {
    method: 'POST', headers, body: multipart ? body : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: 'no-store', redirect: 'error',
  }).catch(() => { throw new Error('Koneksi terputus. Periksa koneksi lalu coba lagi.') })
  if (response.status === 401) throw new Error('Sesi berakhir. Masuk kembali untuk menggunakan laporan masalah.')
  const result = await response.json().catch(() => null)
  if (!response.ok || !result) {
    throw new Error(typeof result?.error === 'string' ? result.error : 'Layanan laporan belum tersedia. Coba lagi.')
  }
  return result as T
}

export function submitIssue(source: IssueSource, id: string, message: string, images: File[], audio: File | null) {
  const form = new FormData()
  form.set('id', id)
  form.set('page', source.page)
  form.set('message', message.trim())
  images.forEach(file => form.append('image', file))
  if (audio) form.append('audio', audio)
  return issueCall<{ id: string }>(form, source)
}

export async function listIssues(filter: IssueStatus | 'all', page: number, signal: AbortSignal) {
  if (!ownerClient) throw new Error('Layanan laporan belum dikonfigurasi.')
  let query = ownerClient.from('website_issues')
    .select('id,reporter_role,reporter_name,page,message,attachment_count,status,created_at')
    .neq('status', 'receiving').order('created_at', { ascending: false }).order('id')
  if (filter !== 'all') query = query.eq('status', filter)
  const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize)
    .abortSignal(signal).returns<Issue[]>()
  if (error?.code === 'PGRST205' || error?.code === '42P01') throw new Error('Layanan laporan masalah belum aktif.')
  if (error) throw new Error('Daftar laporan belum bisa dimuat. Coba lagi.')
  return { issues: data.slice(0, pageSize), more: data.length > pageSize }
}

export async function countNewIssues(signal: AbortSignal) {
  if (!ownerClient) return null
  const { count, error } = await ownerClient.from('website_issues')
    .select('id', { count: 'exact', head: true }).eq('status', 'new').abortSignal(signal)
  if (error?.code === 'PGRST205' || error?.code === '42P01') return null
  if (error) throw error
  return count
}

const ownerSource = { role: 'owner', page: '/owner' } as const

export function issueAttachments(id: string, signal: AbortSignal) {
  return issueCall<{ attachments: IssueAttachment[] }>({ operation: 'media', id }, ownerSource, signal)
}

export function changeIssueStatus(id: string, status: IssueStatus) {
  return issueCall<{ id: string; status: IssueStatus }>({ operation: 'status', id, status }, ownerSource)
}
