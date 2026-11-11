# Fase 6 · QA dan rilis Absen Toko

## Pasang perubahan pada staging

1. Jalankan [migrasi retensi teknis](supabase/migrations/20261111033449_attendance_retention.sql) di SQL Editor, lalu jalankan [uji retensi](supabase/tests/phase6_retention.sql). Jalankan juga uji izin, transaksi, dan Owner dari [panduan Supabase](supabase/README.md).
2. Pasang ulang Edge Function `attendance-api` dan pastikan `owner-api` memakai versi Fase 5. Masukkan origin HTTPS frontend yang benar ke `ALLOWED_ORIGINS`. Aktifkan `TRUST_GATEWAY_IP=true` setelah staging membuktikan gateway menentukan sendiri entri terakhir `X-Forwarded-For` pada setiap jalur publik. Default memakai batas global dan per identitas.
3. Gunakan publishable key atau legacy anon key di frontend. Simpan service role dan secret lain di Supabase Secrets atau lingkungan operator. Pakai akun serta data fiktif untuk pengujian staging.

## Konfigurasi hosting

Jalankan `npm ci && npm run build` dan publikasikan folder `dist` ke hosting statis HTTPS yang paketnya mengizinkan operasional bisnis. Tinjau syarat paket sebelum memilih penyedia. [Ketentuan Vercel Hobby](https://vercel.com/docs/plans/hobby)

Arahkan rute aplikasi seperti `/owner/login`, `/owner`, dan `/owner/reset` ke `index.html`. Sajikan aset dari path aslinya. Terapkan header berikut di hosting. Konfigurasi Vite sudah menyajikannya saat preview lokal. Ganti `https://PROJECT_REF.supabase.co` dengan origin backend.

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: https://PROJECT_REF.supabase.co; media-src 'self' blob:; connect-src 'self' https://PROJECT_REF.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: camera=(self), geolocation=(self), microphone=()
```

## Penerimaan sebelum produksi

- Uji Android Chrome dan iOS Safari fisik lewat HTTPS. Verifikasi keyboard, kamera, GPS, izin ditolak, foto ulang, koneksi terputus saat submit, dan pemulihan dengan ID percobaan yang sama. Pastikan satu transaksi untuk satu absensi.
- Uji dengan dua karyawan fiktif dan dua akun Auth, satu Owner dan satu tanpa peran Owner. Pastikan PIN salah dibatasi, sesi lama ditolak setelah reset PIN, foto privat hanya dibuka oleh Owner, dan URL foto kedaluwarsa. Periksa unggahan yang tidak valid, absensi lintas tengah malam WIB, dua submit bersamaan, serta reset kata sandi lewat email.
- Jalankan audit dependensi frontend dan Edge Function dari lingkungan yang dapat memverifikasi TLS registry. Periksa Security Advisor, pengaturan Auth, CORS, header hosting, dan batas runtime Edge Function. [Checklist Supabase](https://supabase.com/docs/guides/deployment/going-into-prod)
- Catat persetujuan Owner atas hosting, pemberitahuan privasi, retensi data, dan rilis. Foto dan lokasi harus dijelaskan sebelum karyawan mengirimkannya.

## Backup dan pemulihan

Tetapkan periode retensi data serta target kehilangan data dan waktu pemulihan bersama Owner. Gunakan backup database sesuai paket Supabase. Salin objek dari bucket privat secara terpisah ke lokasi terenkripsi dengan akses terbatas. Backup database saja menyimpan metadata Storage. [Panduan backup Supabase](https://supabase.com/docs/guides/platform/backups)

Uji restore ke proyek terisolasi. Pulihkan database dan objek, lalu cocokkan path bukti, periksa RLS dan login Owner, serta verifikasi akses foto melalui signed URL. Catat waktu restore dan titik data yang berhasil dipulihkan.

Jalankan cleanup Fase 3 secara berkala dari lingkungan server yang terkendali. Migrasi Fase 6 menghapus receipt yang telah kedaluwarsa lebih dari satu hari, sesi tanpa intent, dan counter rate limit lama. Intent gagal tetap tercatat sampai penghapusan objek berhasil. Terapkan retensi catatan dan foto absensi melalui prosedur terpisah setelah kebijakan Owner disetujui.
