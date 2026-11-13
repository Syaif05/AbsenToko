> **Teh Idaman:** Lihat bagian [Absensi langsung dan pengelolaan data](#absensi-langsung-dan-pengelolaan-data) untuk rilis terbaru. Instruksi PIN di bagian terdahulu hanya berlaku untuk rilis lama.

# Fase 2 · Setup Supabase lewat Dashboard

Gunakan proyek Supabase yang disiapkan untuk Absen Toko. Jalankan setiap file SQL **secara utuh** di tab SQL Editor baru dengan role `postgres`. Urutan ini bisa dipakai untuk setup awal atau membuat ulang schema pada proyek Supabase baru.

## 1. Buat schema dan bucket privat

1. Buka proyek yang benar di **Supabase Dashboard → SQL Editor → New query**.
2. Salin seluruh isi [migrasi schema](migrations/20261111002144_attendance_schema.sql), tempel, lalu klik **Run**. Sukses biasanya tampil sebagai **Success. No rows returned**. Jalankan migrasi ini satu kali per proyek.
3. Buka **Table Editor → public** dan pastikan tabel `employees`, `attendance`, `attendance_evidence`, dan `owner_profiles` muncul. Buka **Storage** dan pastikan `attendance-photos` berstatus privat. Migrasi membatasi bucket ke JPEG dan 1.000.000 byte per file.

Migrasi berjalan dalam satu transaksi. Jika muncul konflik nama tabel atau policy, periksa objek yang sudah ada sebelum mencoba ulang. Jika bucket sudah ada, migrasi hanya menerimanya bila pengaturan privasi, MIME, dan batas ukurannya sama. Kelola pengaturan bucket dan file melalui Dashboard Storage. [Pembuatan bucket](https://supabase.com/docs/guides/storage/buckets/creating-buckets) · [Kebijakan Storage](https://supabase.com/docs/guides/storage/security/access-control)

## 2. Daftarkan akun Owner

1. Buka **Authentication → Users → Add user**. Buat akun dengan email yang Anda kuasai dan kata sandi unik, atau kirim undangan lewat Dashboard. Pastikan email akun sudah terkonfirmasi. Jika membuat akun sendiri lewat Dashboard dan sudah memverifikasi alamat emailnya, gunakan opsi konfirmasi akun yang tersedia.
2. Salin **User UID** dari detail akun. Di tab SQL Editor baru, tempel isi [skrip provisioning](manual/provision_owner.sql). Ganti UUID nol pada baris `owner_uid constant uuid := ...` dengan UID tadi, pertahankan tanda kutip, lalu klik **Run**. UUID kedua di bawahnya adalah nilai pemeriksaan. Isi skrip hanya memerlukan UID.
3. Buka pengaturan **Authentication** dan matikan **Allow new users to sign up** serta **Allow anonymous sign-ins**. Pertahankan provider **Email** agar akun Owner dapat masuk dengan email dan kata sandi saat frontend diintegrasikan.

Profil Owner hanya diberikan lewat skrip admin. Menjalankan ulang provisioning untuk UID yang sama aman. [Pengelolaan pengguna Auth](https://supabase.com/docs/guides/auth/users) · [Pengaturan Auth](https://supabase.com/docs/guides/auth/general-configuration)

## 3. Jalankan pengujian izin

1. Buka tab SQL Editor baru. Salin seluruh [skrip uji Fase 2](tests/phase2_permissions.sql), lalu klik **Run**.
2. Cari hasil **LULUS — constraint, RLS, izin Owner, dan konfigurasi Storage Fase 2**. Skrip membuat baris fiktif sementara, menguji akses dengan role `anon`, Auth non-Owner, Owner, dan `service_role`, lalu melakukan `ROLLBACK`.
3. Jika ada error, catat pesan pertamanya beserta nama file yang dijalankan. Jika editor melaporkan transaksi masih gagal, jalankan `ROLLBACK;` sebelum mencoba ulang. Untuk error izin saat membuat policy Storage, pastikan SQL Editor memakai role `postgres` dan proyek memberikan izin pengelolaan policy pada `storage.buckets` serta `storage.objects`.

Tes SQL memeriksa konfigurasi bucket dan aturan akses database. Saat bucket kosong, pemeriksaan objek hanya mencakup aturan dan hasil listing kosong. Pengujian HTTP untuk upload, signed URL, dan validasi isi JPEG mengikuti implementasi backend.

## Catatan untuk integrasi

- Dashboard Owner membaca kolom `id,name,is_active,created_at,updated_at` dari `employees`. Hash PIN hanya tersedia untuk backend tepercaya. Penambahan/edit karyawan dan pemberian signed URL foto akan melewati backend yang memverifikasi profil Owner.
- `work_date` dihitung database dari `check_in_at` dalam WIB. Fase 3 akan menulis absensi dan bukti dalam satu transaksi, menegakkan batas sesi, serta menangani PIN, idempotensi, dan upload.
- SQL Editor menerapkan DDL tanpa menambahkan entri riwayat Supabase CLI. Bila nanti beralih ke deployment migrasi lewat CLI, rekonsiliasi riwayat dengan schema yang sudah terpasang sebelum melakukan push.

## Fase 3 · Backend absensi

1. Setelah Fase 2 terpasang, jalankan seluruh `migrations/20261111003058_attendance_backend.sql` di SQL Editor. Jalankan `tests/phase3_transactions.sql` dan pastikan hasilnya `LULUS`.
2. Di Dashboard **Edge Functions → Secrets**, isi `ALLOWED_ORIGINS` dengan daftar origin yang dipisahkan koma, misalnya `http://localhost:5173,https://absensi.example.com`. Buat `RATE_LIMIT_SECRET` acak minimal 32 byte melalui password manager. Environment bawaan Supabase menyediakan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`.
3. Untuk memasang Function secara manual dengan Supabase CLI v3, jalankan `supabase functions deploy attendance-api --remote=PROJECT_REF --use-api` dari folder proyek. Ganti `PROJECT_REF` dengan ID proyek tujuan. Konfigurasi `verify_jwt=false` berlaku khusus endpoint karyawan yang memakai sesi PIN. Operasi selain daftar dan verifikasi memeriksa token sesi pada handler.
4. URL API berbentuk `https://PROJECT_REF.supabase.co/functions/v1/attendance-api`. Semua operasi menggunakan POST JSON. Respons berisi data hanya setelah operasi database sukses. Respons error memakai status HTTP 400/401/403/409/413/429/503.

| Operasi | Isi JSON | Otorisasi |
| --- | --- | --- |
| `list` | `{"operation":"list"}` | Publik, rate limited |
| `verify` | `operation`, `employee_id`, `pin` | PIN karyawan |
| `status` | `{"operation":"status"}` | `Authorization: Bearer TOKEN` |
| `prepare` | `operation`, `attempt_id` UUID, `action` IN atau OUT | Token sesi |
| `logout` | `operation` | Token sesi |
| `receipt` | `operation`, `attempt_id` UUID | Token sesi |
| `submit` | `operation`, `attempt_id`, `photo` base64 JPEG tanpa prefix, `latitude`, `longitude`, `accuracy_m` | Token sesi |

Simpan `attempt_id` yang sama saat retry. Jika respons submit hilang, ulangi submit dengan ID tersebut untuk memperoleh hasil commit sebelumnya selama sesi belum kedaluwarsa. Setelah sesi habis, verifikasi PIN lagi untuk membaca status terbaru. PIN dibersihkan setelah verifikasi. Setelah absen, sesi tetap aktif sampai kedaluwarsa atau pengguna keluar.

Pengaturan masa sesi PIN (default 86400 detik setelah migrasi akun) dan batas sesi kerja (awal 86400 detik) berada di `attendance_private.settings`. Hash PIN Argon2id memakai helper `functions/_shared/pin.ts`; helper ini juga akan dipakai manajemen karyawan pada fase berikutnya. Format foto adalah JPEG maksimal 1.000.000 byte, sisi maksimal 2048 piksel dan maksimal 4 megapiksel. Lokasi segar tetap harus diambil oleh klien. Server memberi cap waktu commit.

Cleanup upload gagal tersedia di `scripts/cleanup.ts`. Operator dapat menjalankannya secara terkontrol menggunakan Deno dengan environment server, melalui `deno run --allow-env --allow-net --config supabase/deno.json supabase/scripts/cleanup.ts`. Cleanup memilih maksimal 100 intent tanpa hasil yang sudah kedaluwarsa lebih dari satu jam. Penghapusan Storage dilakukan sebelum pembersihan intent database. Catatan dan foto absensi yang sudah committed mempunyai kebijakan retensi terpisah sesuai persetujuan Owner.

Jalankan `deno task --config supabase/deno.json check` dan `deno task --config supabase/deno.json test` untuk pemeriksaan lokal. Pengujian SQL lokal memakai PostgreSQL dengan simulasi schema Supabase. Uji HTTP menyeluruh pada Edge Runtime, sumber IP gateway, batas CPU Argon2/JPEG, dan gangguan jaringan Storage masih harus dilakukan pada proyek staging sebelum penggunaan operasional. [Autentikasi Edge Functions](https://supabase.com/docs/guides/functions/auth)

## Fase 5 · Dashboard Owner

1. Setelah Fase 2 dan 3 terpasang, jalankan [migrasi Owner](migrations/20261111005049_owner_management.sql) di SQL Editor. Jalankan [uji Owner](tests/phase5_owner.sql) dan pastikan hasilnya diawali **LULUS**. Uji memakai data sementara dan melakukan rollback.
2. Pasang Edge Function dengan Supabase CLI v3 melalui `supabase functions deploy owner-api --remote=PROJECT_REF --use-api`. Gunakan konfigurasi `ALLOWED_ORIGINS` yang juga dipakai Fase 3. Function memvalidasi access token dengan Supabase Auth dan memeriksa `owner_profiles` sebelum setiap operasi. [Dokumentasi validasi sesi](https://supabase.com/docs/reference/javascript/auth-getuser)
3. Untuk reset kata sandi Owner, tambahkan URL absolut halaman `/owner/reset` di **Authentication → URL Configuration → Redirect URLs**. Contoh lokal `http://localhost:5173/owner/reset`. Buka tautan reset di browser yang sama dengan permintaan awal karena alurnya memakai PKCE. [Dokumentasi reset kata sandi](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
4. Jalankan frontend dan masuk di `/owner/login`. Uji rekap pada tanggal dengan absensi, buka bukti privat, lalu coba tambah, edit, aktif/nonaktif, dan reset PIN pada karyawan uji. Pastikan akun Auth yang belum diprovisioning sebagai Owner ditolak.

Foto dibuka dari bucket privat melalui URL bertanda tangan yang berlaku 60 detik. PIN karyawan dibuat oleh server dan tampil sekali setelah perubahan berhasil. Audit menyimpan UID Owner, ID karyawan, tindakan, dan waktu. Jika respons pembuatan hilang setelah penyimpanan, perbarui daftar dan reset PIN karyawan yang sudah tercatat.

## Pembaruan akun karyawan

1. Di Supabase **SQL Editor**, jalankan seluruh file [migrasi sesi akun](migrations/20261111051138_employee_account_sessions.sql) setelah migrasi sebelumnya. Untuk memeriksa hasil, jalankan [uji akun karyawan](tests/employee_account_sessions.sql) di staging; data uji di-rollback.
2. Dari folder proyek terbaru, jalankan perintah berikut, lalu pilih **Yes** saat CLI meminta konfirmasi:

   ```sh
   npx supabase@3.1.0 functions deploy attendance-api --remote=PROJECT_REF --use-api
   ```

3. Pastikan Vercel memakai commit terbaru. Uji dengan akun karyawan pada perangkat pribadi: masuk dengan PIN, muat ulang halaman, kirim absen masuk, kembali ke akun, lalu lakukan absen pulang tanpa memasukkan PIN lagi. **Keluar Akun** mencabut sesi; membuka kembali halaman kemudian meminta PIN.

Browser hanya menyimpan token sesi, identitas karyawan, dan waktu kedaluwarsa bila opsi **Tetap masuk di perangkat ini** dicentang. PIN, foto dan lokasi tidak ikut tersimpan. Sesi baru berlaku sampai 24 jam; durasi khusus yang sebelumnya sudah diatur tetap dipertahankan. Pengaturan jendela absen pulang terpisah dari durasi login.

## Pengelompokan toko

1. Jalankan [migrasi toko](migrations/20261111054639_store_groups.sql) di **Supabase → SQL Editor** setelah migrasi sesi akun. Karyawan yang sudah ada masuk ke **Toko Utama**. Riwayat sebelum migrasi tetap terlihat di **Semua toko**, karena toko asalnya belum tercatat.
2. Deploy ulang kedua Edge Function dari folder proyek terbaru dan pilih **Yes**:

   ```sh
   npx supabase@3.1.0 functions deploy attendance-api --remote=PROJECT_REF --use-api
   npx supabase@3.1.0 functions deploy owner-api --remote=PROJECT_REF --use-api
   ```

3. Gunakan frontend dari commit pembaruan toko. Bila Vercel terhubung ke GitHub dan deploy otomatis, selesaikan langkah Supabase segera agar pilihan toko dapat dimuat.
4. Di dashboard, buka **Kelola Karyawan → Kelola Toko**. Buat toko, lalu pilih penempatannya saat tambah/edit karyawan. Karyawan tanpa toko belum muncul di pilihan absensi. Pemindahan mencabut sesi lama dan tidak memindahkan riwayat absensi.
5. Untuk menetapkan PIN, buka **Edit → Ubah PIN** dan isi 6–12 angka, atau kosongkan untuk PIN acak. PIN yang dibuat sebelum pembaruan Lihat PIN Aktif hanya tersedia sebagai hash. Ikuti langkah berikut untuk mengaktifkan penyimpanan PIN aktif terenkripsi.

Uji migrasi di staging dengan [uji toko](tests/store_groups.sql). Uji membuat data sementara dan mengembalikannya dengan rollback.

## Lihat dan salin PIN aktif

1. Jalankan [migrasi PIN aktif](migrations/20261111061533_owner_current_pin.sql) di **Supabase → SQL Editor** setelah migrasi toko.
2. Buat kunci khusus dengan `openssl rand -hex 32`. Simpan hasilnya sebagai `OWNER_PIN_ENCRYPTION_KEY` di **Edge Functions → Secrets**. Simpan cadangan kunci di pengelola rahasia. Mengganti atau kehilangan kunci membuat salinan yang sudah disimpan tidak dapat dibuka.
3. Deploy ulang `owner-api` dari folder proyek terbaru, lalu deploy frontend. Login karyawan tetap memeriksa hash PIN melalui `attendance-api`.

   ```sh
   npx supabase@3.1.0 functions deploy owner-api --remote=PROJECT_REF --use-api
   ```
4. Di **Kelola Karyawan → Edit**, gunakan **Lihat PIN** dan **Salin Nama dan PIN**. Untuk akun dengan PIN yang dibuat sebelum pembaruan, gunakan **Ubah PIN** satu kali. PIN baru disimpan bersama salinan terenkripsi, dan pembukaannya dicatat di audit Owner.


## Aktivasi perangkat dan jadwal

1. Di SQL Editor, jalankan [migrasi Teh Idaman](migrations/20261111115133_idaman_schedule_and_activation.sql) setelah migrasi akun dan toko. Migrasi ini juga mendukung proyek yang melewati migrasi PIN aktif. Setelah commit, sesi lama berakhir dan data PIN lama dihapus. Catatan absensi, toko, dan profil karyawan tetap ada.
2. Dalam jendela pemeliharaan yang sama, deploy kedua Edge Function dari versi baru. Kode lama masih mengharapkan kolom PIN, jadi jangan pisahkan tahap migrasi dan deployment terlalu lama.

   ```sh
   npx supabase@3.1.0 functions deploy attendance-api --remote=PROJECT_REF --use-api
   npx supabase@3.1.0 functions deploy owner-api --remote=PROJECT_REF --use-api
   ```

3. Deploy frontend versi baru. Buka **Kelola Karyawan → Profil → Buat Tautan Aktivasi**. Kirim secara pribadi. Tautan berlaku 24 jam dan hanya bisa digunakan sekali. Sesi perangkat berlaku 14 hari. Membuat tautan baru, menonaktifkan karyawan, atau memindahkannya ke toko lain mencabut akses lama.
4. Buka **Jadwal Karyawan**, pilih toko dan bulan, lalu **Unduh Template Excel**. Isi P, M, S, atau O di Excel atau Google Sheets. Jika memakai Sheets, unduh kembali sebagai .xlsx. Unggah, periksa pratinjau, lalu **Simpan Jadwal**. Kode O berarti libur. Sel kosong mempertahankan data yang tersimpan.
5. Buka **Pengaturan** untuk mengganti nama aplikasi. Default adalah **Teh Idaman**.

Uji konfigurasi menggunakan [SQL aktivasi dan jadwal](tests/idaman_schedule_and_activation.sql) pada staging. SQL uji melakukan rollback.


## Absensi langsung dan pengelolaan data

1. Setelah migrasi jadwal dan aktivasi sudah terpasang, jalankan [migrasi absensi langsung](migrations/20261111123220_direct_attendance_and_archives.sql) di SQL Editor.
2. Deploy ulang Edge Function `attendance-api` dan `owner-api` dari versi kode baru, kemudian deploy frontend versi yang sama.
3. Uji dari browser tanpa sesi tersimpan. Pilih toko, pilih nama, dan klik **Lanjutkan Absen**. Pilihan hanya mencakup toko dan karyawan aktif.
4. Di dashboard Owner, buka **Kelola Toko** atau **Kelola Karyawan**. Hapus mengarsipkan data dan mempertahankan jadwal serta riwayat absensi. Pindahkan atau hapus karyawan yang masih terdaftar sebelum menghapus tokonya.

Pemilihan nama tidak memverifikasi identitas. Foto dan lokasi tetap menjadi bukti absensi.

## Pembaruan Owner November 2026

Area Owner memakai navigasi bersama, filter riwayat toko, dan ID permintaan untuk penyimpanan ulang. Login, foto privat, jadwal Excel, serta pengaturan tetap memakai autentikasi dan RLS Supabase.

Urutan pemasangan setelah pengujian staging dan persetujuan produksi

1. Terapkan `20261111142702_owner_reliability.sql` pada skema yang telah memiliki migrasi absensi langsung. Migrasi menambah tabel tanda terima transaksi privat dan RPC `owner_apply_change`. Riwayat migrasi produksi sebelumnya kosong, sehingga periksa skema awal sebelum memakai perintah push seluruh migrasi.
2. Jalankan `supabase/tests/owner_reliability.sql` di staging. Pengujian membatalkan fixture melalui rollback dan memeriksa replay, konflik payload, kegagalan atomik, serta izin.
3. Pasang ulang `owner-api`, kemudian frontend. Function baru kompatibel dengan klien lama melalui ID permintaan yang dibuat server. Jaminan retry dengan ID sama memerlukan frontend baru.
4. Uji memakai akun Owner staging, termasuk login, tambah/edit/arsip, unggah jadwal, dan detail foto. Hasil browser dengan respons simulasi hanya memverifikasi UI dan kontrak respons.

`attendance_private.owner_change_requests` menyimpan ID Owner, target, operasi, hash payload, dan waktu commit. Akses hanya melalui fungsi server. Tanda terima dipertahankan agar pengiriman ulang tetap dikenali. Kebijakan retensinya memerlukan keputusan Owner sebelum cleanup diaktifkan.

Jika rollback aplikasi diperlukan, gunakan kembali frontend dan `owner-api` versi sebelumnya. Tabel dan RPC tambahan dapat tetap ada. Kehadiran karyawan menggunakan API yang sama seperti sebelum pembaruan.

Uji lokal dengan `npm test`, `npm run lint`, dan `npm run build`. Periksa fungsi dengan `deno task --config supabase/deno.json check`.

## Edit jadwal dan hapus toko permanen

Migrasi `20261111144817_owner_schedule_and_store_deletion.sql` menambah penyimpanan satu shift dan memperbarui proses penghapusan toko. Terapkan migrasi, lalu deploy `owner-api` dan frontend.

Klik sel jadwal untuk memilih P, M, S, O, atau mengosongkannya. Template Excel memakai satu tab Jadwal dengan ID karyawan tersembunyi. Template lama untuk toko dan bulan yang sama tetap dapat diimpor. Sel kosong dalam file mempertahankan shift yang sudah tersimpan.

Pindahkan atau arsipkan karyawan yang masih terdaftar sebelum menghapus tokonya. Penghapusan toko juga menghapus jadwal toko tersebut. Absensi dan bukti tetap tersedia di rekap semua toko dengan toko historis belum tercatat.

## Reset data absensi uji

Migrasi `20261111150722_owner_attendance_reset.sql` menambah reset dari **Pengaturan → Reset Data Absensi**. Terapkan migrasi sebelum memasang ulang `owner-api` dan frontend.

Owner harus mengetik `RESET` untuk menghapus seluruh catatan absensi dan bukti terkait. Reset mempertahankan akun, karyawan, toko, jadwal, dan nama aplikasi. Foto dihapus melalui Storage API. Jika penghapusan foto terhenti, ulangi di dialog yang sama untuk memakai tanda terima yang sama. Foto yang masih menunggu pembersihan tetap tercatat di tabel privat sampai Storage mengonfirmasi penghapusan.

## Portal karyawan dan jadwal pribadi

Karyawan memilih toko dan nama, lalu masuk ke menu absensi. Kalender **Jadwal Saya** membaca jadwal Owner per bulan melalui operasi `schedule` pada `attendance-api`. RPC `attendance_my_schedule` hanya dapat dipanggil service role; identitas dan toko diturunkan dari sesi yang masih aktif. Parameter employee/store dari browser tidak digunakan. Jadwal kosong bukan libur; kode O berarti libur. Jadwal tidak mengubah bukti atau status kehadiran aktual. Nama produk tetap Teh Idaman.

Pengujian: `npm test` mencakup validasi endpoint dan `supabase/tests/employee_portal_schedule.sql` mencakup isolasi karyawan, batas bulan, sesi dicabut/kedaluwarsa, karyawan nonaktif, dan izin RPC. Jalankan SQL tersebut pada database pengujian setelah seluruh migrasi; transaksi di-rollback.

## Perbaikan pemeriksaan bukti (13 November 2026)

Migrasi `fix_attendance_intent_session` mengganti fungsi produksi lama yang masih membaca kolom PIN yang sudah dihapus. Regresi `supabase/tests/attendance_commit_current.sql` menjalankan alur pilih karyawan → siapkan bukti → baca intent → masuk → retry → pulang pada skema terkini dalam transaksi rollback. Kamera membatasi penantian izin/video selama 20 detik, menghentikan stream terlambat setelah pembatalan, dan menyediakan pesan untuk mencoba kembali.
