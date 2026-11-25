// Jalankan terkontrol dengan secret server. Menghapus hanya upload gagal yang kedaluwarsa.
import { createClient } from 'npm:@supabase/supabase-js@2.99.2'
const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data, error } = await client.rpc('attendance_cleanup_candidates')
if (error) throw new Error('Gagal memuat daftar cleanup')
for (const intent of data ?? []) {
  const removed = await client.storage.from('attendance-photos').remove([intent.photo_path])
  if (removed.error) throw new Error('Cleanup Storage gagal, jalankan ulang')
  const finished = await client.rpc('attendance_cleanup_done', { p_id: intent.id })
  if (finished.error) throw new Error('Cleanup database gagal, jalankan ulang')
}
const pruned = await client.rpc('attendance_prune_technical_data')
if (pruned.error) throw new Error('Pembersihan data teknis gagal, jalankan ulang')

// Ambil hanya laporan yang belum diterima. Simpan laporan terkirim dan lampirannya.
const stale = await client.from('website_issues').select('id,upload_id,updated_at,media')
  .eq('status', 'receiving').lt('updated_at', new Date(Date.now() - 86_400_000).toISOString())
  .order('updated_at').limit(100)
if (stale.error && stale.error.code !== 'PGRST205' && stale.error.code !== '42P01')
  throw new Error('Daftar lampiran laporan gagal dimuat')
for (const issue of stale.data ?? []) {
  const claimed = await client.from('website_issues').update({ updated_at: new Date().toISOString() })
    .eq('id', issue.id).eq('status', 'receiving').eq('upload_id', issue.upload_id)
    .eq('updated_at', issue.updated_at).select('id').maybeSingle()
  if (claimed.error) throw new Error('Cleanup laporan gagal mengunci kiriman')
  if (!claimed.data) continue
  if (issue.media.length) {
    const removed = await client.storage.from('website-issue-media')
      .remove(issue.media.map((file: { path: string }) => file.path))
    if (removed.error) throw new Error('Cleanup lampiran laporan gagal, jalankan ulang')
  }
  const deleted = await client.from('website_issues').delete().eq('id', issue.id)
    .eq('status', 'receiving').eq('upload_id', issue.upload_id)
  if (deleted.error) throw new Error('Cleanup kiriman laporan gagal, jalankan ulang')
}
console.log('Cleanup selesai')
