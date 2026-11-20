import { createClient } from 'npm:@supabase/supabase-js@2.99.2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
    },
  },
)
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function readBody(request: Request) {
  const reader = request.body?.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let body = ''
  while (reader) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 25_000) {
      await reader.cancel()
      throw new Error('body too large')
    }
    body += decoder.decode(chunk.value, { stream: true })
  }
  return JSON.parse(body + decoder.decode())
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')
  const headers = new Headers({
    'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'cache-control': 'no-store',
    'content-type': 'application/json',
    vary: 'Origin',
  })
  if (origin && origins.includes(origin)) headers.set('access-control-allow-origin', origin)
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { headers, status })
  if (origin && !origins.includes(origin)) return respond({ error: 'Origin tidak diizinkan.' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { headers, status: 204 })
  if (request.method !== 'POST') return respond({ error: 'Gunakan POST.' }, 405)
  const token = request.headers.get('authorization')?.match(/^Bearer (\S{1,8192})$/i)?.[1]
  if (!token) return respond({ error: 'Silakan masuk kembali.' }, 401)

  try {
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token)
    if (authError || !user) return respond({ error: 'Silakan masuk kembali.' }, 401)
    const { data: owner, error: roleError } = await admin
      .from('owner_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .maybeSingle()
    if (roleError) return respond({ error: 'Hak akses belum bisa diperiksa.' }, 503)
    if (!owner) return respond({ error: 'Akses Owner diperlukan.' }, 403)

    const body = await readBody(request).catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return respond({ error: 'Permintaan tidak valid.' }, 400)
    const { operation, id } = body
    if (typeof id !== 'string' || !uuid.test(id)) return respond({ error: 'ID tidak valid.' }, 400)

    const limit = await admin.rpc('attendance_take_limit', {
      p_key: (operation === 'photo' ? 'owner-photo:' : 'owner-write:') + user.id,
      p_limit: operation === 'photo' ? 120 : 20,
      p_seconds: 60,
    })
    if (limit.error) return respond({ error: 'Layanan belum tersedia.' }, 503)
    if (!limit.data)
      return respond({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, 429)

    if (operation === 'stock_edit' || operation === 'stock_delete') {
      const deleting = operation === 'stock_delete'
      if (typeof body.version !== 'string' || !Number.isFinite(Date.parse(body.version))
        || (!deleting && (typeof body.notes !== 'string' || body.notes.length > 500
          || !body.values || typeof body.values !== 'object' || Array.isArray(body.values)))) {
        return respond({ error: 'Periksa isian laporan.' }, 400)
      }
      const result = await admin.rpc('owner_update_stock_opname', {
        p_owner: user.id, p_id: id, p_version: body.version, p_delete: deleting,
        p_values: deleting ? null : body.values, p_notes: deleting ? null : body.notes,
      })
      if (result.error?.message === 'so invalid value') return respond({ error: 'Periksa format jumlah stok.' }, 400)
      if (result.error?.message === 'so stale report') return respond({ error: 'Laporan sudah berubah. Buka kembali untuk melihat data terbaru.' }, 409)
      if (result.error || result.data?.ok !== true) return respond({ error: 'Perubahan belum dikonfirmasi. Muat ulang laporan.' }, 503)
      return respond({ ok: true })
    }

    if (operation === 'review_request') {
      if (typeof body.approve !== 'boolean' || typeof body.note !== 'string' || body.note.trim().length<5 || body.note.length>500) return respond({error:'Isi catatan keputusan 5–500 karakter.'},400)
      const result = await admin.rpc('owner_review_attendance_request',{p_owner:user.id,p_id:id,p_approve:body.approve,p_note:body.note})
      if(result.error || result.data?.ok!==true) return respond({error:'Keputusan belum tersimpan. Perbarui data: pengajuan mungkin sudah diproses, karyawan berpindah toko, atau waktu bertabrakan dengan absensi lain.'},409)
      return respond({ok:true})
    }
    if (operation === 'confirm_checkout') {
      if (!uuid.test(body.attendance_id ?? '') || typeof body.checkout !== 'string' || !Number.isFinite(Date.parse(body.checkout)) || typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) return respond({ error: 'Isi jam pulang dan alasan (5–500 karakter).' }, 400)
      const result = await admin.rpc('owner_confirm_checkout', { p_owner: user.id, p_request: id, p_attendance: body.attendance_id, p_checkout: body.checkout, p_reason: body.reason })
      if (result.error) return respond({ error: 'Konfirmasi belum tersimpan. Jam pulang harus setelah masuk, tidak di masa depan, maksimal 48 jam setelah masuk, dan tidak bertabrakan dengan absensi berikutnya. Perbarui data bila sudah dikonfirmasi.' }, 409)
      if (result.data?.ok !== true) return respond({ error: 'Hasil belum dapat dikonfirmasi. Coba lagi.' }, 503)
      return respond({ ok: true })
    }

    if (operation === 'reset_attendance') {
      if (body.confirmation !== 'RESET') {
        return respond({ error: 'Ketik RESET untuk mengonfirmasi.' }, 400)
      }
      const reset = await admin.rpc('owner_reset_attendance', { p_owner: user.id, p_request: id })
      if (
        reset.error ||
        !Number.isInteger(reset.data?.deleted) ||
        !Array.isArray(reset.data?.paths)
      ) {
        return respond({ error: 'Reset belum dikonfirmasi. Coba lagi dari dialog yang sama.' }, 503)
      }
      const paths: string[] = reset.data.paths
      if (!paths.length) return respond({ ok: true, complete: true, deleted: reset.data.deleted })

      const removed = await admin.storage.from('attendance-photos').remove(paths)
      if (removed.error) {
        return respond(
          { error: 'Catatan sudah direset, tetapi foto masih menunggu penghapusan. Coba lagi.' },
          503,
        )
      }
      const finished = await admin.rpc('owner_finish_attendance_reset_photos', { p_paths: paths })
      if (finished.error || typeof finished.data !== 'boolean') {
        return respond({ error: 'Pembersihan foto belum dikonfirmasi. Coba lagi.' }, 503)
      }
      return respond({ ok: true, complete: finished.data, deleted: reset.data.deleted })
    }

    if (operation === 'photo') {
      const { data: evidence, error } = await admin
        .from('attendance_evidence')
        .select('photo_path')
        .eq('id', id)
        .maybeSingle()
      if (error) return respond({ error: 'Foto belum bisa dimuat.' }, 503)
      if (!evidence) return respond({ error: 'Bukti tidak ditemukan.' }, 404)
      const signed = await admin.storage
        .from('attendance-photos')
        .createSignedUrl(evidence.photo_path, 60)
      if (signed.error) return respond({ error: 'Foto belum bisa dimuat.' }, 503)
      return respond({ url: signed.data.signedUrl })
    }

    if (
      ![
        'create',
        'rename',
        'activate',
        'deactivate',
        'archive_employee',
        'archive_store',
        'delete_store',
        'create_store',
        'rename_store',
      ].includes(operation)
    ) {
      return respond({ error: 'Operasi tidak valid.' }, 400)
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (
      ['create', 'rename', 'create_store', 'rename_store'].includes(operation) &&
      (!name || name.length > 80 || /\p{Cc}/u.test(name))
    ) {
      return respond({ error: 'Nama harus berisi 1–80 karakter.' }, 400)
    }
    if (
      ['create', 'rename'].includes(operation) &&
      body.store_id !== null &&
      (typeof body.store_id !== 'string' || !uuid.test(body.store_id))
    )
      return respond({ error: 'Toko tidak valid.' }, 400)
    const requestId = body.request_id ?? crypto.randomUUID()
    if (typeof requestId !== 'string' || !uuid.test(requestId))
      return respond({ error: 'ID permintaan tidak valid.' }, 400)
    const result = await admin.rpc('owner_apply_change', {
      p_owner: user.id,
      p_request: requestId,
      p_id: id,
      p_store: body.store_id ?? null,
      p_operation: operation,
      p_name: name || null,
    })
    if (result.error) {
      const messages: Record<string, string> = {
        'store unavailable': 'Toko sudah diarsipkan atau belum tersedia. Perbarui daftar.',
        'employee unavailable': 'Karyawan sudah diarsipkan atau belum tersedia. Perbarui daftar.',
        'request conflict': 'Isi permintaan berubah. Tutup formulir dan coba kembali.',
        'invalid name': 'Nama harus berisi 1–80 karakter.',
      }
      if (messages[result.error.message])
        return respond({ error: messages[result.error.message] }, 409)
      if (result.error.code === 'PGRST202')
        return respond({ error: 'Pembaruan database Owner belum terpasang.' }, 503)
      if (result.error.message === 'store has employees') {
        return respond(
          { error: 'Pindahkan atau hapus semua karyawan dari toko ini terlebih dahulu.' },
          409,
        )
      }
      if (operation.endsWith('_store') && result.error.code === '23505') {
        return respond({ error: 'Nama toko sudah dipakai.' }, 409)
      }
      return respond(
        {
          error:
            operation === 'create' && result.error.code === '23505'
              ? 'Karyawan mungkin sudah tersimpan. Perbarui daftar sebelum mencoba lagi.'
              : 'Perubahan belum dikonfirmasi. Perbarui daftar sebelum mencoba lagi.',
        },
        409,
      )
    }
    if (result.data?.ok !== true)
      return respond({ error: 'Perubahan belum dikonfirmasi server.' }, 503)
    return respond(result.data)
  } catch {
    return respond({ error: 'Layanan Owner belum tersedia. Coba lagi.' }, 503)
  }
})
