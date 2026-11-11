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
console.log('Cleanup selesai')
