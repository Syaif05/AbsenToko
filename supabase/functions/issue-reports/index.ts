import { createClient } from 'npm:@supabase/supabase-js@2.99.2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean)
const bucket = admin.storage.from('website-issue-media')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ownerPages = ['/owner', '/owner/karyawan', '/owner/toko', '/owner/jadwal', '/owner/stock-opname', '/owner/pengaturan']
const maxImage = 4 * 1024 * 1024
const maxAudio = 6 * 1024 * 1024
const maxRequest = 5 * maxImage + maxAudio + 100_000
const leaseMs = 10 * 60 * 1000

type Reporter = { id: string; name: string; role: 'owner' | 'employee' }
type Media = { path: string; kind: 'image' | 'audio' }

class Failure extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function limit(key: string, attempts: number, seconds: number) {
  const { data, error } = await admin.rpc('attendance_take_limit', { p_key: key, p_limit: attempts, p_seconds: seconds })
  if (error) throw new Failure(503, 'Layanan laporan belum tersedia. Coba lagi.')
  if (data !== true) throw new Failure(429, 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.')
}

async function identify(request: Request): Promise<Reporter> {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S{1,8192})$/i)?.[1]
  if (!token) throw new Failure(401, 'Masuk terlebih dahulu untuk menggunakan laporan masalah.')
  if (/^[0-9a-f]{64}$/.test(token)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const { data, error } = await admin.rpc('website_issue_employee', { p_hash: hash })
    if (error) throw new Failure(503, 'Sesi karyawan belum bisa diperiksa.')
    if (!data) throw new Failure(401, 'Sesi berakhir. Pilih nama dan toko kembali.')
    return { id: data.id, name: data.name, role: 'employee' }
  }
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw new Failure(401, 'Sesi berakhir. Masuk kembali.')
  const { data, error: roleError } = await admin.from('owner_profiles')
    .select('user_id').eq('user_id', user.id).eq('role', 'owner').maybeSingle()
  if (roleError) throw new Failure(503, 'Hak akses belum bisa diperiksa.')
  if (!data) throw new Failure(403, 'Akses Owner diperlukan.')
  return { id: user.id, name: 'Owner', role: 'owner' }
}

function boundedBody(request: Request, max: number) {
  if (!request.body) throw new Failure(400, 'Isi laporan diperlukan.')
  const contentType = request.headers.get('content-type') ?? ''
  if (Number(request.headers.get('content-length')) > max) throw new Failure(413, 'Ukuran lampiran terlalu besar.')
  let bytes = 0
  const stream = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.length
      if (bytes > max) throw new Failure(413, 'Ukuran lampiran terlalu besar.')
      controller.enqueue(chunk)
    },
  }))
  return new Response(stream, { headers: { 'Content-Type': contentType } })
}

async function readForm(request: Request) {
  try {
    return await boundedBody(request, maxRequest).formData()
  } catch (error) {
    if (error instanceof Failure) throw error
    throw new Failure(400, 'Format laporan belum dapat dibaca. Coba kirim ulang.')
  }
}

async function inspect(file: FormDataEntryValue, kind: Media['kind']) {
  const label = kind === 'image' ? 'Gambar' : 'Rekaman'
  if (!(file instanceof File) || file.size < 12 || file.size > (kind === 'image' ? maxImage : maxAudio)) {
    throw new Failure(400, label + ' kosong atau melebihi batas ukuran.')
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const starts = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte)
  const ascii = (offset: number, length: number) => String.fromCharCode(...head.slice(offset, offset + length))
  const mime = file.type.toLowerCase().split(';')[0]
  let extension: string | undefined
  if (kind === 'image') {
    if (mime === 'image/jpeg' && starts(255, 216, 255)) extension = 'jpg'
    if (mime === 'image/png' && starts(137, 80, 78, 71, 13, 10, 26, 10)) extension = 'png'
    if (mime === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') extension = 'webp'
  } else {
    if (mime === 'audio/webm' && starts(26, 69, 223, 163)) extension = 'webm'
    if (mime === 'audio/ogg' && ascii(0, 4) === 'OggS') extension = 'ogg'
    if (mime === 'audio/mp4' && ascii(4, 4) === 'ftyp') extension = 'm4a'
  }
  if (!extension) throw new Failure(400, 'Format ' + label.toLowerCase() + ' tidak didukung.')
  return { file, mime, extension, kind }
}

async function submit(request: Request, reporter: Reporter) {
  await limit('issue-submit:' + reporter.role + ':' + reporter.id, 10, 3600)
  const form = await readForm(request)
  const id = form.get('id')
  const description = form.get('message')
  const page = form.get('page')
  if (typeof id !== 'string' || !uuid.test(id) ||
    typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 12000 ||
    typeof page !== 'string' || !(reporter.role === 'employee' ? page === '/' : ownerPages.includes(page))) {
    throw new Failure(400, 'Periksa halaman dan isi laporan (10–12.000 karakter).')
  }

  const existing = await admin.from('website_issues').select('status,upload_id,updated_at,media')
    .eq('id', id).eq('reporter_id', reporter.id).eq('reporter_role', reporter.role).maybeSingle()
  if (existing.error) throw new Failure(503, 'Laporan belum dapat diperiksa. Coba lagi.')
  if (existing.data && existing.data.status !== 'receiving') return { id }
  if (existing.data && Date.now() - Date.parse(existing.data.updated_at) < leaseMs) {
    throw new Failure(409, 'Kiriman sebelumnya sedang diproses. Coba kirim ulang beberapa saat lagi.')
  }

  const images = form.getAll('image')
  const audio = form.getAll('audio')
  if (images.length > 5 || audio.length > 1) throw new Failure(400, 'Maksimal lima gambar dan satu rekaman.')
  const files = await Promise.all([...images.map(file => inspect(file, 'image')), ...audio.map(file => inspect(file, 'audio'))])
  const uploadId = crypto.randomUUID()
  const media: Media[] = files.map((file, index) => ({ path: id + '/' + uploadId + '/' + index + '.' + file.extension, kind: file.kind }))
  const fields = { page, message: description.trim(), media, upload_id: uploadId, updated_at: new Date().toISOString() }
  const previous = existing.data?.media as Media[] | undefined
  if (previous?.length) {
    const removed = await bucket.remove(previous.map(file => file.path))
    if (removed.error) throw new Failure(503, 'Lampiran kiriman sebelumnya belum bisa dipulihkan. Coba lagi.')
  }
  const reservation = existing.data
    ? await admin.from('website_issues').update(fields).eq('id', id).eq('status', 'receiving')
      .eq('upload_id', existing.data.upload_id).eq('updated_at', existing.data.updated_at).select('id').maybeSingle()
    : await admin.from('website_issues').insert({ ...fields, id, reporter_id: reporter.id,
      reporter_role: reporter.role, reporter_name: reporter.name }).select('id').single()
  if (reservation.error?.code === '23505' || (!reservation.error && !reservation.data)) {
    throw new Failure(409, 'Kiriman sebelumnya sedang diproses. Coba kirim ulang beberapa saat lagi.')
  }
  if (reservation.error) throw new Failure(503, 'Laporan belum dapat disimpan. Coba lagi.')

  const uploads = await Promise.allSettled(files.map((file, index) => bucket.upload(media[index].path, file.file, {
    contentType: file.mime, upsert: false, cacheControl: '60',
  })))
  if (uploads.some(result => result.status === 'rejected' || result.value.error)) {
    const removed = await bucket.remove(media.map(file => file.path)).catch(() => null)
    if (removed && !removed.error) {
      await admin.from('website_issues').delete().eq('id', id).eq('status', 'receiving').eq('upload_id', uploadId)
    }
    throw new Failure(503, 'Lampiran belum tersimpan. Periksa koneksi, lalu kirim ulang.')
  }

  const finalized = await admin.from('website_issues').update({ status: 'new', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'receiving').eq('upload_id', uploadId).select('id').single()
  if (finalized.error || !finalized.data) throw new Failure(503, 'Penerimaan belum terkonfirmasi. Coba kirim ulang.')
  return { id }
}

async function manage(request: Request, reporter: Reporter) {
  if (reporter.role !== 'owner') throw new Failure(403, 'Akses Owner diperlukan.')
  await limit('issue-manage:' + reporter.id, 60, 60)
  const input = await boundedBody(request, 4000).json().catch(() => null)
  if (typeof input?.id !== 'string' || !uuid.test(input.id)) throw new Failure(400, 'Laporan tidak valid.')

  if (input.operation === 'status' && ['new', 'reviewing', 'resolved'].includes(input.status)) {
    const { data, error } = await admin.from('website_issues').update({ status: input.status, updated_at: new Date().toISOString() })
      .eq('id', input.id).neq('status', 'receiving').select('id,status').maybeSingle()
    if (error) throw new Failure(503, 'Status belum bisa disimpan. Coba lagi.')
    if (!data) throw new Failure(404, 'Laporan tidak ditemukan.')
    return data
  }
  if (input.operation !== 'media') throw new Failure(400, 'Operasi tidak valid.')
  const { data, error } = await admin.from('website_issues').select('media').eq('id', input.id)
    .neq('status', 'receiving').maybeSingle()
  if (error) throw new Failure(503, 'Lampiran belum bisa dibuka.')
  if (!data) throw new Failure(404, 'Laporan tidak ditemukan.')
  const media = data.media as Media[]
  if (!media.length) return { attachments: [] }
  const signed = await bucket.createSignedUrls(media.map(file => file.path), 900)
  if (signed.error || !signed.data || signed.data.some(file => !file.signedUrl || file.error)) {
    throw new Failure(503, 'Lampiran belum bisa dibuka. Coba lagi.')
  }
  return { attachments: signed.data.map((file, index) => ({ kind: media[index].kind, url: file.signedUrl })) }
}

Deno.serve(async request => {
  const origin = request.headers.get('origin') ?? ''
  const headers = {
    ...(origins.includes(origin) && { 'Access-Control-Allow-Origin': origin }),
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  }
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  try {
    if (origin && !origins.includes(origin)) throw new Failure(403, 'Origin tidak diizinkan.')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') throw new Failure(405, 'Gunakan POST.')
    await limit('issue-ingress', 180, 60)
    const reporter = await identify(request)
    const multipart = request.headers.get('content-type')?.startsWith('multipart/form-data;')
    return respond(multipart ? await submit(request, reporter) : await manage(request, reporter))
  } catch (error) {
    if (error instanceof Failure) return respond({ error: error.message }, error.status)
    console.error('Issue reports request failed')
    return respond({ error: 'Layanan laporan belum tersedia. Coba lagi.' }, 503)
  }
})
