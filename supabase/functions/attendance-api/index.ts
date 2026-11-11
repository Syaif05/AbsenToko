import { createClient } from 'npm:@supabase/supabase-js@2.99.2'
import jpeg from 'npm:jpeg-js@0.4.4'

const required = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error('Missing server configuration')
  return value
}
const client = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const origins = required('ALLOWED_ORIGINS').split(',').map(value => value.trim())
const bucket = client.storage.from('attendance-photos')
const encoder = new TextEncoder()
const rateSecret = required('RATE_LIMIT_SECRET')
if (rateSecret.length < 32 || origins.some(origin => !/^https?:\/\//.test(origin) || origin.includes('*'))) throw new Error('Invalid server configuration')
const sourceKey = await crypto.subtle.importKey('raw', encoder.encode(rateSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('')
const digest = async (value: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', new Uint8Array(value).buffer))
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
class Failure extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args)
  if (error?.code === 'P0001' && error.message === 'invalid session') {
    throw new Failure(401, 'Sesi berakhir. Pilih toko dan nama kembali.')
  }
  if (error) throw new Failure(409, 'Permintaan tidak dapat diproses. Periksa status absensi kembali.')
  return data
}
async function limit(key: string, count: number, seconds: number) {
  if (!await rpc('attendance_take_limit', { p_key: key, p_limit: count, p_seconds: seconds })) {
    throw new Failure(429, 'Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.')
  }
}
async function boundedJson(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Failure(400, 'Isi permintaan diperlukan.')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.length
    if (length > 1_400_000) { await reader.cancel(); throw new Failure(413, 'Ukuran permintaan terlalu besar.') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch { throw new Failure(400, 'Format permintaan tidak valid.') }
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const headers = {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0],
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store', 'Vary': 'Origin', 'Content-Type': 'application/json',
  }
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  try {
    if (origin && !origins.includes(origin)) throw new Failure(403, 'Origin tidak diizinkan.')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') throw new Failure(405, 'Gunakan POST.')
    await limit('global', 300, 60)
    // Enable only after confirming the gateway overwrites the final entry.
    const forwarded = Deno.env.get('TRUST_GATEWAY_IP') === 'true'
      ? request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
      : undefined
    const sourceHash = forwarded && /^[0-9a-f:.]{3,45}$/i.test(forwarded)
      ? hex(await crypto.subtle.sign('HMAC', sourceKey, encoder.encode(forwarded)))
      : null
    if (sourceHash) await limit('source:' + sourceHash, 60, 60)
    const body = await boundedJson(request)
    if (body.operation === 'stores') {
      const { data, error } = await client.from('stores').select('id,name').is('archived_at', null).order('name')
      if (error) throw new Failure(503, 'Daftar toko belum bisa dimuat.')
      return respond({ stores: data })
    }
    if (body.operation === 'list') {
      if (!uuid(body.store_id)) throw new Failure(400, 'Pilih toko yang valid.')
      const { data, error } = await client.from('employees').select('id,name,stores!inner(id)')
        .eq('store_id', body.store_id).eq('is_active', true).is('archived_at', null).is('stores.archived_at', null)
        .order('name')
      if (error) throw new Failure(503, 'Daftar karyawan belum bisa dimuat.')
      return respond({ employees: data.map(({ id, name }) => ({ id, name })) })
    }
    if (body.operation === 'select_employee') {
      if (!uuid(body.store_id) || !uuid(body.employee_id)) throw new Failure(400, 'Pilih toko dan nama yang valid.')
      await limit('select:' + body.employee_id, 10, 60)
      const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const { data, error } = await client.rpc('attendance_select_employee', {
        p_store: body.store_id, p_employee: body.employee_id, p_session: await digest(encoder.encode(token)),
      })
      if (error?.message === 'employee unavailable') throw new Failure(409, 'Karyawan sudah tidak tersedia di toko ini. Pilih kembali.')
      if (error || !data) throw new Failure(503, 'Sesi absensi belum bisa dibuka. Coba lagi.')
      return respond({ token, ...data })
    }
    if (body.operation === 'activate') {
      if (typeof body.invitation !== 'string' || !/^[0-9a-f]{64}$/.test(body.invitation)) {
        throw new Failure(400, 'Tautan aktivasi tidak valid.')
      }
      const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer)
      const { data, error } = await client.rpc('employee_activate', {
        p_invitation: await digest(encoder.encode(body.invitation)),
        p_session: await digest(encoder.encode(token)),
      })
      if (error?.message === 'invalid invitation') {
        throw new Failure(401, 'Tautan sudah dipakai, kedaluwarsa, atau tidak berlaku. Minta tautan baru kepada Owner.')
      }
      if (error || !data) throw new Failure(503, 'Aktivasi belum tersedia. Coba lagi.')
      return respond({ token, ...data })
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '')
    if (!token || !/^[0-9a-f]{64}$/.test(token)) throw new Failure(401, 'Pilih toko dan nama terlebih dahulu.')
    const hash = await digest(encoder.encode(token))
    await limit('session:' + hash, 30, 60)
    if (body.operation === 'status') return respond(await rpc('attendance_status', { p_hash: hash }))
    if (body.operation === 'logout') {
      await rpc('attendance_end_session', { p_hash: hash })
      return respond({ ok: true })
    }
    if (!uuid(body.attempt_id)) throw new Failure(400, 'ID percobaan tidak valid.')
    if (body.operation === 'prepare') {
      if (!['IN', 'OUT'].includes(body.action)) throw new Failure(400, 'Jenis absensi tidak valid.')
      return respond(await rpc('attendance_prepare', { p_hash: hash, p_id: body.attempt_id, p_action: body.action }))
    }
    if (body.operation === 'receipt') {
      const intent = await rpc('attendance_get_intent', { p_hash: hash, p_id: body.attempt_id })
      return respond({ receipt: intent.result })
    }
    if (body.operation !== 'submit') throw new Failure(400, 'Operasi tidak tersedia.')
    const intent = await rpc('attendance_get_intent', { p_hash: hash, p_id: body.attempt_id })
    if (intent.result) return respond(intent.result)
    const { latitude, longitude, accuracy_m } = body
    if (![latitude, longitude, accuracy_m].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy_m < 0) throw new Failure(400, 'Lokasi tidak valid.')
    if (typeof body.photo !== 'string' || body.photo.length > 1_333_336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.photo)) throw new Failure(400, 'Foto JPEG diperlukan.')
    let photo: Uint8Array
    try {
      photo = Uint8Array.from(atob(body.photo), char => char.charCodeAt(0))
      if (photo.length > 1_000_000 || photo[0] !== 255 || photo[1] !== 216) throw new Error()
      const decoded = jpeg.decode(photo, { useTArray: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 32, tolerantDecoding: false })
      if (!decoded.width || !decoded.height || decoded.width > 2048 || decoded.height > 2048) throw new Error()
    } catch { throw new Failure(400, 'Foto JPEG tidak valid atau terlalu besar.') }
    const { error: uploadError } = await bucket.upload(intent.photo_path, photo, { contentType: 'image/jpeg', upsert: false })
    if (uploadError) {
      const { data: existing, error } = await bucket.download(intent.photo_path)
      if (error || !existing || await digest(new Uint8Array(await existing.arrayBuffer())) !== await digest(photo)) {
        throw new Failure(503, 'Foto belum berhasil dikirim. Periksa status lalu coba lagi.')
      }
    }
    return respond(await rpc('attendance_commit', { p_hash: hash, p_id: body.attempt_id, p_lat: latitude, p_lng: longitude, p_accuracy: accuracy_m }))
  } catch (error) {
    return respond({ error: error instanceof Failure ? error.message : 'Layanan belum tersedia. Coba lagi.' }, error instanceof Failure ? error.status : 503)
  }
})
