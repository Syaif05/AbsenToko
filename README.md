# Absen Toko

Website absensi karyawan untuk satu usaha dengan zona waktu Asia/Jakarta. Lihat [AGENTS.md](AGENTS.md) untuk spesifikasi produk dan urutan implementasi.

## Setup lokal

Gunakan Node.js 24 dan npm. Dari folder proyek, jalankan:

```sh
npm ci
npm run dev
```

Buka `http://localhost:5173`.

```sh
npm run lint
npm run typecheck
npm run build
npm run preview
```

## Demo karyawan

Aktifkan `VITE_ATTENDANCE_MODE=demo` untuk mencoba halaman karyawan dengan PIN contoh **246810**. Pilih Alya untuk masuk, Bima untuk pulang, atau Citra untuk melihat status selesai. Perubahan demo tersimpan di memori tab.

## Setup Supabase Fase 2

Ikuti [panduan SQL Editor](supabase/README.md) untuk menjalankan migrasi schema, mendaftarkan Owner, dan menguji izin.

Backend Fase 3, kontrak API, konfigurasi server, dan langkah pemasangan Edge Function tersedia pada bagian Fase 3 di panduan yang sama. Jalankan migrasi backend setelah migrasi Fase 2.

## Konfigurasi

Salin `.env.example` ke `.env.local` bila perlu mengubah nama aplikasi. URL dan publishable key Supabase boleh dikosongkan sampai fase integrasi. Semua variabel `VITE_` bersifat publik. Simpan rahasia backend di Supabase Secrets saat backend disiapkan.


## Integrasi karyawan Fase 4

1. Jalankan migrasi Fase 2 dan 3, lalu pasang ulang Edge Function `attendance-api` dari kode terbaru sesuai [panduan Supabase](supabase/README.md). Versi ini menambahkan operasi `receipt`.
2. Buat `.env.local` dari `.env.example` dan isi URL serta publishable key proyek. Masukkan origin frontend dalam `ALLOWED_ORIGINS` di Supabase.
3. Jalankan `npm run dev` dan buka halaman karyawan. Gunakan karyawan uji yang sudah memiliki hash PIN di database staging.
4. Untuk mencoba alur demo Fase 1, atur `VITE_ATTENDANCE_MODE=demo` dan restart Vite. Mode default menggunakan API.

Jika koneksi putus saat pengiriman, gunakan **Periksa dan Coba Lagi**. Aplikasi mencari hasil transaksi dengan ID percobaan yang sama sebelum mencoba mengirim kembali. Setelah sesi habis, verifikasi PIN kembali untuk membaca status terbaru.


## Dashboard Owner Fase 5

Ikuti [panduan Supabase Fase 5](supabase/README.md#fase-5--dashboard-owner), lalu masuk di `/owner/login` dengan akun Owner yang sudah diprovisioning. Hosting SPA perlu meneruskan rute seperti `/owner/reset` ke `index.html`.

## QA dan rilis Fase 6

Ikuti [panduan rilis](RELEASE.md) untuk migrasi retensi teknis, pemeriksaan staging, konfigurasi hosting, dan pemulihan backup.
