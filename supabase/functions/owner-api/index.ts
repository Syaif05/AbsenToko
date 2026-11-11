import { createClient } from 'npm:@supabase/supabase-js@2.99.2'
import { hashPin, verifyPin } from '../_shared/pin.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function newPin() {
  const sample = new Uint32Array(1)
  // Rejection sampling keeps all one million PINs equally likely.
  do { crypto.getRandomValues(sample) } while (sample[0] >= 4_294_000_000)
  return String(sample[0] % 1_000_000).padStart(6, '0')
}

async function readBody(request: Request) {
  const reader = request.body?.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let body = ''
  while (reader) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 4096) { await reader.cancel(); throw new Error('body too large') }
    body += decoder.decode(chunk.value, { stream: true })
  }
  return JSON.parse(body + decoder.decode())
}

Deno.serve(async request => {
  const origin = request.headers.get('origin')
  const headers = new Headers({
    'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'cache-control': 'no-store', 'content-type': 'application/json', vary: 'Origin',
  })
  if (origin && origins.includes(origin)) headers.set('access-control-allow-origin', origin)
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { headers, status })
  if (origin && !origins.includes(origin)) return respond({ error: 'Origin tidak diizinkan.' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 })
  if (request.method !== 'POST') return respond({ error: 'Gunakan POST.' }, 405)
  const token = request.headers.get('authorization')?.match(/^Bearer (\S{1,8192})$/i)?.[1]
  if (!token) return respond({ error: 'Silakan masuk kembali.' }, 401)

  try {
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return respond({ error: 'Silakan masuk kembali.' }, 401)
    const { data: owner, error: roleError } = await admin.from('owner_profiles').select('user_id')
      .eq('user_id', user.id).eq('role', 'owner').maybeSingle()
    if (roleError) return respond({ error: 'Hak akses belum bisa diperiksa.' }, 503)
    if (!owner) return respond({ error: 'Akses Owner diperlukan.' }, 403)

    const body = await readBody(request).catch(() => null)
    if (!body || typeof body !== 'object') return respond({ error: 'Permintaan tidak valid.' }, 400)
    const { operation, id } = body
    if (typeof id !== 'string' || !uuid.test(id)) return respond({ error: 'ID tidak valid.' }, 400)

    if (operation === 'photo') {
      const { data: evidence, error } = await admin.from('attendance_evidence')
        .select('photo_path').eq('id', id).maybeSingle()
      if (error) return respond({ error: 'Foto belum bisa dimuat.' }, 503)
      if (!evidence) return respond({ error: 'Bukti tidak ditemukan.' }, 404)
      const signed = await admin.storage.from('attendance-photos').createSignedUrl(evidence.photo_path, 60)
      if (signed.error) return respond({ error: 'Foto belum bisa dimuat.' }, 503)
      return respond({ url: signed.data.signedUrl })
    }

    if (!['create', 'rename', 'activate', 'deactivate', 'reset_pin', 'create_store', 'rename_store'].includes(operation)) {
      return respond({ error: 'Operasi tidak valid.' }, 400)
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (['create', 'rename', 'create_store', 'rename_store'].includes(operation) && (!name || name.length > 80 || /\p{Cc}/u.test(name))) {
      return respond({ error: 'Nama harus berisi 1–80 karakter.' }, 400)
    }
    if (['create', 'rename'].includes(operation) && body.store_id !== null &&
      (typeof body.store_id !== 'string' || !uuid.test(body.store_id))) return respond({ error: 'Toko tidak valid.' }, 400)
    if (operation === 'reset_pin' && body.pin !== undefined &&
      (typeof body.pin !== 'string' || !/^\d{6,12}$/.test(body.pin))) return respond({ error: 'PIN harus terdiri dari 6–12 angka.' }, 400)
    const limited = await admin.rpc('attendance_take_limit', { p_key: 'owner-write:' + user.id, p_limit: 20, p_seconds: 60 })
    if (limited.error) return respond({ error: 'Layanan belum tersedia.' }, 503)
    if (!limited.data) return respond({ error: 'Terlalu banyak perubahan. Coba lagi sebentar.' }, 429)
    let previousHash: string | null = null
    if (operation === 'reset_pin') {
      const { data, error } = await admin.from('employees').select('pin_hash').eq('id', id).maybeSingle()
      if (error) return respond({ error: 'PIN belum bisa direset.' }, 503)
      if (!data) return respond({ error: 'Karyawan tidak ditemukan.' }, 404)
      previousHash = data.pin_hash
    }

    let pin: string | null = null
    if (operation === 'create' || operation === 'reset_pin') {
      if (operation === 'reset_pin' && typeof body.pin === 'string') {
        if (previousHash && await verifyPin(body.pin, previousHash)) return respond({ error: 'Pilih PIN yang berbeda dari PIN saat ini.' }, 400)
        pin = body.pin
      } else {
        do { pin = newPin() } while (previousHash && await verifyPin(pin, previousHash))
      }
    }
    const result = await admin.rpc('owner_manage_store_assignment', {
      p_owner: user.id, p_id: id, p_store: body.store_id ?? null, p_operation: operation, p_name: name || null,
      p_pin_hash: pin ? await hashPin(pin) : null, p_previous_hash: previousHash,
    })
    if (result.error) {
      return respond({ error: operation === 'create' && result.error.code === '23505'
        ? 'Karyawan mungkin sudah tersimpan. Perbarui daftar dan reset PIN bila diperlukan.'
        : 'Perubahan belum dikonfirmasi. Perbarui daftar sebelum mencoba lagi.' }, 409)
    }
    return respond({ pin })
  } catch {
    return respond({ error: 'Layanan Owner belum tersedia. Coba lagi.' }, 503)
  }
})
