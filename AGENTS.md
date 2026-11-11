# AGENTS.md — PRD & Aturan AI Coding Agent

**Proyek:** Website Absensi Karyawan Sederhana  
**Versi dokumen:** 1.0  
**Tanggal:** 11 November 2026  
**Bahasa produk:** Indonesia  
**Status:** Spesifikasi implementasi awal  
**Target:** Aplikasi production-ready berskala usaha kecil, dibuat dengan bantuan AI coding agent  

> **Instruksi utama untuk AI:** Baca dokumen ini sebelum mengubah kode. Jadikan sebagai sumber kebenaran untuk ruang lingkup, keamanan, UX, dan kriteria selesai. Jangan menganggap dokumen ini izin untuk menjalankan migrasi produksi, membagikan kredensial, menghapus data, atau melakukan deployment tanpa persetujuan pengguna. Jika keputusan teknis belum pasti, pilih implementasi paling sederhana yang aman dan catat asumsi secara singkat.

---

## Ruang lingkup Teh Idaman

Spesifikasi ini diperbarui untuk permintaan Teh Idaman. Bagian historis yang menjelaskan login PIN dan tidak adanya jadwal tidak berlaku bagi versi ini. Owner membuat tautan aktivasi satu kali yang terikat pada satu karyawan. Jadwal bulanan per toko memakai P, M, S, O dan dapat diimpor dari template Excel. Jadwal bersifat perencanaan, sementara rekap absensi tetap berisi bukti kehadiran aktual. Nama aplikasi dapat diganti dari Pengaturan Owner.

## 1. Visi dan prinsip produk

Bangun website absensi **sangat sederhana, cepat, aman, mobile-first**. Karyawan membuka tautan, memilih nama, mengisi PIN pribadi, mengambil foto langsung, mengizinkan GPS, dan melakukan **Absen Masuk** atau **Absen Pulang**. Owner masuk melalui autentikasi khusus untuk melihat status absensi setiap karyawan pada tanggal tertentu, foto, koordinat, dan riwayat.

**Prioritas berurutan (jangan dibalik):**
1. Keamanan dan privasi data karyawan.
2. Keandalan dan integritas waktu/bukti absensi.
3. Kegunaan di berbagai ukuran layar HP.
4. Kesederhanaan dan kecepatan aplikasi.
5. Kemudahan konfigurasi serta pemindahan proyek.
6. Kerapian kode dan biaya operasional yang terkendali.

**Non-goals MVP:** Tidak membuat shift, jadwal libur, cuti, payroll, lembur, approval, face recognition, absensi offline, geofencing/radius toko, chat, notifikasi push/WhatsApp, multi-tenant, manajemen cabang, ekspor Excel/PDF, laporan analytics kompleks, atau fitur HRIS lain. Jangan menambahkannya kecuali diminta.

## 2. Pengguna dan hak akses

| Peran | Akses | Larangan |
| --- | --- | --- |
| Karyawan | Memilih identitas dari daftar terbatas, verifikasi PIN, melihat status absensi hariannya setelah verifikasi, mengirim foto/GPS untuk masuk dan pulang | Tidak boleh membaca PIN/hash, foto atau riwayat karyawan lain, mengedit waktu, mengubah bukti, melihat dashboard Owner |
| Owner | Login email/password, melihat rekap dan detail kehadiran, filter tanggal, menambah/edit/nonaktifkan karyawan, mengatur dan melihat PIN aktif melalui alur aman | Akses PIN aktif hanya untuk Owner, diaudit, dan tervalidasi di server |

**Asumsi MVP:** Satu usaha, satu zona waktu operasional **Asia/Jakarta (WIB)**, satu Owner utama, kurang lebih 2–30 karyawan; desain database tidak mengunci kemungkinan perluasan. Tidak ada pendaftaran Owner publik. Owner dibuat melalui proses administrasi aman. Jangan membuat akun Owner dengan password hard-coded.

## 3. Stack final dan alasan

- **Frontend:** React + Vite + TypeScript, Single Page Application (SPA).
- **Styling:** Tailwind CSS, CSS variables untuk token desain; gunakan sedikit dependensi.
- **Routing:** React Router jika dibutuhkan oleh tiga halaman, jangan memasang framework besar tanpa alasan.
- **Backend:** Supabase PostgreSQL, Supabase Auth (khusus Owner), Supabase Storage privat, Supabase Edge Functions (verifikasi PIN dan penulisan absensi), transaksi SQL/RPC privat jika diperlukan.
- **Foto:** `navigator.mediaDevices.getUserMedia()`; pilih kamera depan bila tersedia. Foto dikompresi di klien sebelum upload, lalu diverifikasi ulang di server.
- **GPS:** `navigator.geolocation.getCurrentPosition()` dengan permintaan izin yang jelas.
- **Waktu:** Timestamp resmi dari server/database UTC; konversi ke WIB hanya untuk tampilan dan penentuan `work_date` sesuai aturan bisnis.
- **Hosting:** Frontend statis di penyedia yang mengizinkan penggunaan bisnis. Vercel dapat digunakan untuk pengembangan/pratinjau sesuai syarat layanannya; **jangan mengasumsikan Vercel Hobby boleh dipakai untuk operasional usaha**, karena paket Hobby berorientasi penggunaan personal nonkomersial. Deployment produksi harus memverifikasi syarat paket terkini atau memilih alternatif yang mengizinkan bisnis.
- **PWA:** Opsional setelah MVP stabil; bila diaktifkan, hanya instalasi/icon dan cache aset publik. Jangan cache foto, PIN, token privat, atau respons sensitif; **absensi tetap online-only**.

**Tidak dipakai pada MVP:** Next.js, server VPS, Firebase sekaligus Supabase, Google Apps Script/Sheets sebagai sumber data utama, state manager berat, microservices, ORM yang tidak diperlukan.

### 3.1 Konfigurasi dan kemudahan transfer

Gunakan `.env.example` tanpa rahasia; konfigurasi terbagi menjadi (a) environment frontend yang publik dan (b) secret server yang tidak pernah masuk frontend. Publishable key Supabase boleh ada di frontend dengan RLS ketat; **service role / secret key tidak boleh**. Sertakan `README.md` ringkas tentang setup dan migrasi antar-akun, tanpa menyimpan credential pribadi.

Contoh variabel frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APP_NAME`. Rahasia Edge Functions harus disimpan lewat secret manager Supabase, bukan `VITE_`.

## 4. Alur UX & halaman

### 4.1 Rute

- `/` — Absensi Karyawan (publik hanya untuk memilih identitas dan melakukan verifikasi aman).
- `/owner/login` — Login Owner.
- `/owner` — Dashboard Owner (protected route, proteksi wajib ditegakkan di backend/RLS, bukan sekadar frontend).
- `*` — 404 sederhana.

### 4.2 Alur karyawan (masuk dan pulang)

1. Karyawan membuka halaman, melihat judul singkat dan tanggal/hari lokal.
2. Pilih nama dari daftar karyawan aktif (tidak mengungkap detail privat). Jika daftar dianggap sensitif, alternatif adalah input kode pegawai; keputusan keamanan dapat ditingkatkan tanpa mengubah alur utama.
3. Masukkan PIN pribadi; server memverifikasi dengan pembatasan percobaan dan memberi sesi absensi sementara yang **terikat employee_id**, berumur pendek, tidak dapat dipalsukan, dan memiliki scope hanya untuk operasi absensi. Jangan mempercayai `employee_id` yang dikirim ulang setelah verifikasi tanpa mencocokkannya dengan sesi.
4. Backend mengembalikan status hari ini: `NOT_CHECKED_IN`, `CHECKED_IN`, atau `COMPLETED`.
5. Jika `NOT_CHECKED_IN`, tampilkan **Absen Masuk**. Jika `CHECKED_IN`, tampilkan **Absen Pulang**. Jika `COMPLETED`, tampilkan selesai dan waktu ringkas.
6. Saat tombol proses ditekan, minta izin kamera dan lokasi dengan penjelasan sederhana. Ambil **foto baru** dari kamera; jangan menawarkan unggah dari galeri pada MVP. Ambil lokasi segar saat absensi, bukan lokasi yang disimpan lama.
7. Tampilkan pratinjau foto, status GPS, dan tombol konfirmasi. Jika ditolak/gagal, tampilkan pesan manusiawi, petunjuk perbaikan dan tombol coba lagi; jangan membuat data palsu.
8. Server memvalidasi sesi/PIN yang sudah diverifikasi, state kehadiran, token upload/bukti, ukuran dan tipe foto, koordinat, batas waktu, dan idempotency key. Server mengambil waktu resmi dan menulis absensi secara atomik sesuai desain.
9. UI hanya menyatakan **Berhasil** setelah backend mengonfirmasi commit. Jika jaringan gagal/tidak pasti, cek status ulang sebelum mengirim, jangan mengklaim berhasil secara optimistis.
10. Setelah sukses, bersihkan PIN dan token sementara dari state. Jangan simpan PIN di localStorage, sessionStorage, URL, analytics, atau log.

**Batasan:** Kamera browser dan GPS tidak membuktikan keaslian kehadiran sepenuhnya; PIN bisa dibagikan, GPS bisa dipalsukan, dan kamera browser bisa disimulasikan. Jangan membuat klaim anti-kecurangan sempurna.

### 4.3 Alur Owner

1. Owner login dengan Supabase Auth email/password melalui `/owner/login`.
2. Dashboard default tanggal hari ini dalam WIB; tampilkan **Total Karyawan Aktif**, **Sudah Masuk**, **Belum Masuk**, dan bila relevan **Sudah Pulang**.
3. Daftar: nama, jam masuk, jam pulang, status (`Belum Masuk`, `Sedang Bekerja`, `Selesai`).
4. Filter tanggal menggunakan date picker sederhana. Tampilkan empty state bila tidak ada absensi.
5. Ketuk nama untuk detail: foto masuk/pulang, waktu resmi, koordinat, akurasi GPS, tautan `https://www.google.com/maps?q=<lat>,<lng>` yang dibentuk dari koordinat yang telah divalidasi/encoded.
6. Kelola Karyawan: tambah nama dan PIN awal secara aman; edit nama; aktif/nonaktif; reset PIN. Untuk mengurangi menu, pengelolaan ini boleh berupa satu modal/sheet.
7. Logout jelas; password reset Owner lewat alur Supabase Auth yang aman, bukan membuat password sendiri.

**Arti status:** `Belum Masuk` artinya **belum ada catatan masuk pada tanggal yang dipilih**, bukan otomatis mangkir/terlambat. Tidak ada jadwal kerja atau shift, jadi aplikasi **tidak boleh** menghitung telat/alpa.

## 5. Desain UI/UX — mobile-first wajib

### 5.1 Karakter visual

- Bersih, modern, ringan; sedikit teks; aksen warna konsisten; radius lembut dan elevasi halus.
- **Jangan** memakai efek blur/glassmorphism berat yang mengurangi FPS/keterbacaan, terutama pada HP murah.
- Gunakan font system/UI yang ringan; jangan mendownload banyak font/icon pack.
- Satu CTA utama per tahap. Hindari popup berlapis, sidebar kompleks, animasi berlebihan, dan tabel horizontal untuk halaman karyawan.
- Dashboard HP memakai kartu ringkasan dan list, bukan tabel desktop sempit. Desktop boleh memakai tabel responsif.
- Gunakan bahasa Indonesia yang jelas: `Absen Masuk`, `Absen Pulang`, `Ambil Foto`, `Lokasi terdeteksi`, `Coba Lagi`, `Absensi berhasil`.

### 5.2 Responsivitas

- **Ukuran layar uji wajib:** lebar viewport 320, 360, 375, 390, 412, 430, 768, 1024, dan 1440 px; portrait utama, landscape tidak rusak.
- Jangan ada scroll horizontal yang tidak disengaja di layar 320 px.
- Form karyawan satu kolom, maksimal lebar nyaman sekitar 420 px di desktop; hindari konten terlalu melebar.
- Tombol sentuh minimal sekitar 44×44 CSS px, jarak cukup antaraksi, label dapat dibaca tanpa zoom.
- Dukungan safe-area `env(safe-area-inset-*)`, keyboard virtual, dan browser bar HP. CTA tidak tertutup keyboard; jangan memaksa viewport terkunci yang menghalangi zoom.
- `viewport` harus menghormati zoom pengguna. Input tidak terlalu kecil pada iOS untuk menghindari autozoom yang mengganggu.
- Camera preview memakai `object-fit: cover`, menyediakan fallback bila `facingMode: user` tidak didukung, dan berhenti memakai kamera setelah selesai/unmount.
- Loader, skeleton, error state, success state, serta loading tombol harus konsisten.
- Aksesibilitas: kontras yang memadai, label programatis, fokus keyboard terlihat, status error dibacakan, dukung reduced motion.

### 5.3 Target performa

- Initial bundle kecil; lazy-load halaman Owner/fitur yang berat; jangan menambahkan library bila native API sudah cukup.
- Foto target terkompresi sekitar 100–300 KB jika kualitas tetap layak; batas teknis maksimum ditetapkan server (misalnya 1 MB) dengan pembatasan dimensi dan validasi MIME/magic bytes.
- Hindari request berulang; polling dashboard hanya bila perlu (contoh 30–60 detik, dihentikan saat tab tersembunyi), ditambah tombol refresh. Tidak wajib mengaktifkan Realtime untuk MVP.
- Target UX: interaksi lancar di HP kelas bawah, layout tidak bergeser signifikan, respons tombol jelas, gambar diunduh secara malas (`lazy`) di Owner.

## 6. Model data

Gunakan UUID dan constraint database. Simpan semua timestamp sebagai `timestamptz` UTC. `work_date` adalah tanggal bisnis **Asia/Jakarta** ketika masuk; lihat aturan lintas tengah malam.

### 6.1 `employees`

| Kolom | Tipe / aturan |
| --- | --- |
| `id` | UUID PK, default generated |
| `name` | text NOT NULL; trim, batas panjang; boleh nama sama sehingga ID tetap identitas utama |
| `pin_hash` | text NOT NULL; Argon2id atau password hashing kuat setara, salt unik; jangan disimpan/dikembalikan plaintext |
| `is_active` | boolean NOT NULL DEFAULT true |
| `created_at`, `updated_at` | timestamptz |

**PIN:** Hindari PIN 4 digit lemah tanpa mitigasi. Rekomendasi PIN numerik minimal 6 digit acak atau passcode yang lebih kuat; PIN aktif yang ditetapkan lewat fitur baru dapat dilihat dan disalin oleh Owner. Simpan hanya hash untuk verifikasi dan salinan PIN aktif terenkripsi dengan kunci di secret manager; hapus salinan sebelumnya saat PIN berubah. Batasi dan audit setiap pembukaan PIN aktif tanpa menyimpan nilainya di log. Terapkan pembatasan percobaan per identitas dan sumber serta cooldown.

### 6.2 `attendance`

| Kolom | Tipe / aturan |
| --- | --- |
| `id` | UUID PK |
| `employee_id` | UUID FK `employees.id` NOT NULL |
| `work_date` | date NOT NULL |
| `check_in_at` | timestamptz NOT NULL |
| `check_out_at` | timestamptz NULL |
| `created_at` | timestamptz NOT NULL |
| `updated_at` | timestamptz NOT NULL |

- UNIQUE(`employee_id`, `work_date`).
- CHECK(`check_out_at IS NULL OR check_out_at >= check_in_at`).
- Catatan absensi tidak dihapus otomatis ketika karyawan dinonaktifkan; gunakan foreign key yang tidak melakukan cascade delete atas histori.
- Pembaruan pulang hanya boleh pada baris yang sudah masuk dan belum pulang, melalui transaksi/operasi server yang atomik.

### 6.3 `attendance_evidence`

| Kolom | Tipe / aturan |
| --- | --- |
| `id` | UUID PK |
| `attendance_id` | UUID FK `attendance.id` NOT NULL |
| `type` | enum/check `IN` atau `OUT` |
| `photo_path` | text NOT NULL; path objek privat, bukan public URL |
| `latitude`, `longitude` | numeric/double precision dalam rentang valid (-90..90, -180..180) |
| `accuracy_m` | numeric >= 0 |
| `recorded_at` | timestamptz NOT NULL dari server |

- UNIQUE(`attendance_id`, `type`).
- Pastikan bukti `IN` ada sebelum status masuk dinyatakan lengkap; bukti `OUT` ada sebelum status pulang dinyatakan lengkap.
- Koordinat adalah **data yang diklaim perangkat**, jangan menyatakan sudah diverifikasi secara fisik.

### 6.4 Tabel pendukung minimal (jika diperlukan keamanan)

- `owner_profiles`: `user_id` FK ke `auth.users`, role `owner` yang **tidak bisa diubah oleh user biasa**. Satu atau lebih Owner hanya melalui provisioning aman. Jangan menentukan peran dari metadata yang bisa diedit sendiri.
- `attendance_attempts` / state rate-limit: menyimpan kegagalan PIN/aktivitas security dengan masa retensi singkat dan tanpa data rahasia; bila menggunakan layanan rate-limit eksternal, dokumentasikan konfigurasi.
- `attendance_sessions`/nonce atau token bertanda tangan pendek: satu scope karyawan, expiry singkat, invalidasi sesuai kebutuhan. Pilih mekanisme sederhana yang benar-benar dapat diverifikasi server, bukan token acak tanpa penyimpanan/validasi.
- `upload_intents` atau state setara: ikat path foto sementara ke karyawan, jenis absensi, expiry dan nonce; bersihkan upload yang gagal/tertinggal.

## 7. Kebijakan tanggal dan lintas tengah malam

- **Tidak ada shift**, sehingga tidak boleh menebak jadwal kerja.
- `work_date` ditetapkan ketika absensi masuk, menggunakan waktu server di zona WIB.
- Absen pulang mengakhiri sesi masuk yang masih terbuka, termasuk bila sudah lewat pukul 00.00, **dengan batas maksimal jendela sesi yang ditetapkan dan dicatat** (nilai awal usulan 24 jam; konfigurasi server, bukan hardcode UI).
- Jangan membiarkan karyawan memiliki dua sesi terbuka sekaligus. Jika sesi melewati batas, tampilkan kebutuhan penanganan Owner/manual menurut kebijakan yang nanti disetujui, bukan diam-diam mengubah tanggal atau membuat pulang palsu.
- Jika karyawan sudah `COMPLETED` dan mencoba absen masuk lagi pada tanggal yang sama, tolak dengan pesan yang jelas.
- Tidak ada fitur koreksi absensi oleh Owner dalam MVP. Jika nanti ditambahkan, wajib audit trail untuk perubahan waktu/bukti.

## 8. Arsitektur API dan transaksi aman

**Catatan:** Rincian implementasi Edge Function harus mengikuti dokumentasi Supabase terkini; kebijakan `verify_jwt`/mode autentikasi berbeda untuk request Owner vs karyawan non-Auth. Jangan menonaktifkan proteksi JWT secara serampangan untuk mengatasi error 401.

### 8.1 Endpoints konseptual

1. `list-active-employees` (publik, minimal): hanya `id` dan nama yang diperlukan, dengan rate limiting/pagination jika relevan. Jangan mengembalikan PIN hash, lokasi, foto, atau data lain.
2. `verify-employee`: menerima employee ID + PIN melalui POST HTTPS; normalisasi input, perlambat/brute-force block, verifikasi hash di server, terbitkan token sesi sementara scoped; respons status harian setelah valid.
3. `prepare-attendance`: sesi karyawan valid, menyatakan `IN`/`OUT`, menentukan path upload acak tunggal dalam bucket privat, menghasilkan signed upload URL berumur pendek atau strategi upload lain yang aman; metadata dikunci server.
4. `submit-attendance`: cek sesi, nonce/idempotency key, bukti foto benar-benar ada dan valid, koordinat dan akurasi valid, syarat state, expiry; tulis perubahan status dan evidence atomik, respons waktu resmi.
5. Owner: Supabase Auth + RLS untuk baca dashboard; tindakan create/edit/deactivate/reset PIN melalui endpoint server terproteksi Owner, bukan update langsung sembarang tabel.

**Jangan menganggap signed upload URL cukup untuk menjamin foto diambil langsung dari kamera.** Client camera UX membantu, namun upload dan GPS tetap dapat dipalsukan. Cegah penggunaan ulang bukti, file raksasa, dan object path traversal; batasi ukuran dan bersihkan objek orphan.

### 8.2 Konsistensi

- Gunakan transaksi database untuk menyimpan perubahan `attendance` dan `attendance_evidence` sebagai satu operasi logis; lakukan kondisi unik/lock/conditional update untuk race condition dua perangkat.
- Jika penyimpanan foto berhasil tetapi transaksi DB gagal, hapus foto sementara lewat cleanup terjadwal/terkontrol; jangan menyajikan status sukses.
- Idempotency key unik per percobaan untuk mencegah double-tap dan retry menghasilkan duplikasi. Tampilkan hasil sukses yang sama bila idempotency key sama dan data sudah tersimpan.
- Server mengabaikan `timestamp` yang dikirim klien sebagai sumber kebenaran; browser hanya mengirim data lokasi dan bukti foto.
- Pesan error publik tidak mengungkap struktur database, rahasia, stacktrace, atau apakah PIN tertentu valid secara detail yang memudahkan enumerasi.

## 9. Security baseline — WAJIB / blocking release

1. **HTTPS** di produksi; kamera dan geolocation meminta izin user dalam secure context. Jangan melakukan workaround insecure.
2. **Tidak ada secret di frontend/repo/log.** Gunakan secret manager; `.env` di `.gitignore`; commit hanya `.env.example`.
3. **RLS enable** di semua tabel schema yang diekspos; deny-by-default. Pengunjung anon tidak dapat `SELECT` attendance, evidence, hashes, owner profiles, dan Storage privat.
4. **Owner authorization server-side** dengan UID/role terpercaya. `authenticated` saja **bukan** bukti Owner. Jangan menggunakan `user_metadata` editabel untuk otorisasi.
5. **Operasi karyawan melalui server** dengan verifikasi sesi terbatas; tidak ada CRUD langsung anon pada tabel sensitif.
6. **Hash PIN** dengan algoritma password hashing (Argon2id yang aman atau setara) dan salt unik. Rate limit/cooldown brute force berdasarkan kombinasi identitas dan sumber, bukan IP saja. Pertimbangkan CAPTCHA hanya jika penyalahgunaan terjadi dan tidak mengorbankan UX tanpa alasan.
7. **Validate all inputs** di server: UUID, PIN, ukuran nama, jenis aksi, lokasi, akurasi, MIME/signature gambar, ukuran byte, path, panjang session, date/time.
8. **File privacy:** Bucket private, signed URLs untuk akses Owner dengan expiry pendek, tidak ada public listing, path acak tanpa nama karyawan, validasi file dan pembatasan ukuran, retensi/pembersihan foto orphan.
9. **Least privilege:** fungsi privileged hanya mengakses tabel yang dibutuhkan; service-role tetap hanya di server; cek izin setiap endpoint. Jangan meletakkan fungsi `SECURITY DEFINER` terbuka di `public` tanpa audit ketat dan revokasi EXECUTE.
10. **CORS allowlist** origin produksi/development yang sah; jangan wildcard bila memakai credential; respons tidak mengungkap rahasia.
11. **Client hardening:** Hindari `dangerouslySetInnerHTML` untuk input user; escape output; gunakan dependensi terpercaya, lockfile, dan audit dependency. Tambahkan security headers relevan (CSP yang diuji, Referrer-Policy, X-Content-Type-Options, frame restrictions).
12. **Brute-force & abuse:** batas ukuran request, rate limiting semua endpoint sensitif, lockout sementara yang tidak dapat dipakai untuk DoS permanen pada identitas karyawan, monitoring error.
13. **Audit minimal:** peristiwa Owner mengelola karyawan, reset PIN, dan kegagalan auth tanpa menyimpan nilai PIN/foto/koordinat di log aplikasi. Log sensitif dibatasi akses/retensi.
14. **Privacy by design:** kumpulkan lokasi hanya saat absen, bukan tracking terus-menerus; minta persetujuan/beri pemberitahuan sederhana tentang foto + lokasi, tujuan, siapa dapat mengakses, masa simpan, dan prosedur penghapusan. Tidak mengaktifkan analytics invasif.
15. **Backup/restore:** dokumentasikan strategi backup database, retensi dan pemulihan; fitur backup otomatis tergantung paket. Uji pemulihan sebelum mempercayakan data produksi.
16. **No fake success:** bila gagal simpan, jangan menampilkan status berhasil.
17. **Security review wajib** sebelum deploy: cek RLS negatif (anon/karyawan tidak bisa baca data privat), upload, IDOR, auth bypass, concurrent request, PIN bruteforce, secret scan, error handling.

**Prioritas privasi:** Foto dan koordinat dapat menjadi data pribadi. Owner bertanggung jawab atas pemberitahuan, dasar pemrosesan yang sah, pembatasan akses, retensi, dan kepatuhan hukum perlindungan data yang berlaku di Indonesia. Dokumen ini bukan nasihat hukum; periksa kewajiban spesifik sebelum produksi.

## 10. Kebijakan foto, GPS, dan waktu

- **Foto:** Foto baru dari kamera (kamera depan preferensi, kamera belakang fallback), crop/resize tanpa membahayakan orientasi, kompres sebelum upload; preview dan tombol ambil ulang. Jangan menggunakan foto galerinya di alur resmi MVP. Jangan menyimpan foto permanen di browser. Buang EXIF jika memungkinkan untuk meminimalkan metadata tidak perlu.
- **GPS:** Request hanya pada saat tindakan absensi, `enableHighAccuracy` bila bermanfaat; gunakan timeout, tampilkan status dan `accuracy_m`; tolak koordinat invalid, dan putuskan ambang akurasi operasional yang realistis secara konfigurasi (misal tampilkan peringatan jika >100 m, tanpa otomatis menolak jika lokasi indoor buruk). Tidak ada geofence.
- **Waktu:** `recorded_at`, check-in dan check-out dicap oleh server ketika operasi diterima/di-commit, bukan waktu foto menurut HP. Bedakan waktu server dan waktu perangkat di kode; gunakan format tampilan `HH:mm` WIB dan tanggal eksplisit.
- **Retensi (usulan awal yang harus dikonfirmasi Owner):** simpan catatan kehadiran 12 bulan atau sesuai kebutuhan legal/usaha; foto lebih singkat (misal 90 hari) bila layak. Jangan mengaktifkan penghapusan otomatis sebelum disetujui Owner; dokumentasikan jadwal cleanup aman serta kemampuan ekspor/arsip jika diperlukan.

## 11. Aturan UI state dan pesan

| State | Contoh UI |
| --- | --- |
| Memuat daftar karyawan | Skeleton pendek, bukan layar putih |
| Memverifikasi PIN | Loading di tombol, disable submit ganda |
| PIN salah | `Nama atau PIN tidak sesuai. Coba lagi.` |
| Kamera ditolak | `Izin kamera belum diberikan. Aktifkan dari pengaturan browser.` |
| GPS ditolak | `Izin lokasi diperlukan untuk absensi. Aktifkan lokasi, lalu coba lagi.` |
| Akurasi lemah | `Lokasi kurang akurat. Coba di area terbuka atau ulangi.` |
| Upload gagal | `Foto belum berhasil dikirim. Periksa koneksi dan coba lagi.` |
| Sudah absen masuk | `Anda sudah absen masuk pukul 08.02. Selanjutnya Absen Pulang.` |
| Sudah masuk & pulang | `Absensi hari ini sudah lengkap.` |
| Offline | `Koneksi internet diperlukan untuk mengirim absensi.` |

Jangan menggunakan toast berulang untuk pesan kritis; gunakan pesan inline yang mudah dibaca. Sukses menampilkan waktu server, tanpa mengekspos URL bucket/file privat.

## 12. Rancangan halaman konkret

### Karyawan `/`

Urutan komponen pada HP:
1. Header kecil logo/ikon dan nama aplikasi.
2. Salam singkat + tanggal WIB.
3. `Pilih nama` (searchable jika daftar panjang; pilihan tidak mengubah keamanan), input PIN dengan tombol tampil/sembunyi opsional.
4. Tombol `Lanjutkan` untuk verifikasi; setelah valid tampilkan status dan aksi otomatis `Absen Masuk` atau `Absen Pulang`.
5. Komponen kamera besar dengan foto preview dan retake.
6. Indikator GPS + akurasi (tanpa peta berat).
7. CTA sticky aman di bawah (`Kirim Absen Masuk/Pulang`) yang tidak menutupi konten/keyboard.
8. Pesan sukses/error.

**Jangan langsung membuka kamera sebelum user berinteraksi**, agar izin terasa jelas dan hemat baterai.

### Owner `/owner`

- Header minimal `Dashboard` + tanggal + keluar.
- Empat kartu ringkasan: total aktif, sudah masuk, belum masuk, sudah pulang. Pada HP gunakan grid 2 kolom.
- Filter tanggal dan (opsional) pencarian nama.
- Daftar karyawan dengan status warna **plus teks**, jam masuk/pulang; detail via bottom sheet pada HP, dialog pada desktop.
- Tombol `Kelola Karyawan` membuka halaman/modals sederhana, jangan membuat admin panel kompleks.
- Foto dimuat hanya ketika membuka detail (private signed URL), tampilkan koordinat dan tautan Google Maps.

## 13. Struktur proyek yang disarankan

```text
absensi-app/
├── AGENTS.md
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json              # atau lockfile package manager pilihan, satu saja
├── index.html
├── src/
│   ├── app/                       # routing & providers
│   ├── pages/
│   │   ├── AttendancePage.tsx
│   │   ├── OwnerLoginPage.tsx
│   │   └── OwnerDashboardPage.tsx
│   ├── components/
│   │   ├── CameraCapture.tsx
│   │   ├── GpsCapture.tsx
│   │   ├── EmployeeSelector.tsx
│   │   ├── AttendanceStatus.tsx
│   │   └── ui/                    # komponen kecil reusable
│   ├── features/attendance/       # types, API client & flow
│   ├── features/owner/            # owner types & actions
│   ├── lib/supabase.ts
│   ├── styles/
│   └── main.tsx
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── tests/
└── tests/
    ├── unit/
    └── e2e/
```

Jangan memecah setiap komponen kecil ke puluhan file tanpa manfaat. Jangan menaruh semua logic di satu file. Pisahkan data access, komponen UI, dan aturan bisnis.

## 14. Pengujian & acceptance criteria (Definition of Done)

### 14.1 Fungsional

- [ ] Karyawan aktif dapat dipilih dan diverifikasi dengan PIN benar.
- [ ] PIN salah tidak membuka status pribadi dan percobaan dibatasi.
- [ ] Foto diambil langsung dari kamera; retake bekerja.
- [ ] GPS diminta saat absen; koordinat dan akurasi tercatat.
- [ ] Masuk tercatat satu kali dengan waktu server.
- [ ] Pulang hanya setelah masuk; tercatat satu kali dengan foto/GPS baru.
- [ ] Tidak ada duplikasi ketika double-tap, retry, atau dua HP mengirim bersamaan.
- [ ] Kegagalan upload/transaksi tidak menghasilkan absensi sukses palsu.
- [ ] Owner melihat semua karyawan aktif: sudah masuk / belum masuk / sudah pulang.
- [ ] Owner dapat melihat histori berdasarkan tanggal, detail bukti dan tautan lokasi.
- [ ] Owner dapat menambah, edit, nonaktifkan karyawan dan reset PIN aman.
- [ ] Sesi lintas tengah malam sesuai aturan `work_date` yang diuji.

### 14.2 Keamanan

- [ ] Semua tabel exposed memiliki RLS yang telah diuji, bukan sekadar diaktifkan.
- [ ] Anon tidak bisa membaca attendance, evidence, PIN hash, foto, owner profiles.
- [ ] Karyawan A tidak bisa mengakses data/bukti karyawan B dengan mengganti ID/path.
- [ ] Pengguna Auth biasa tidak otomatis menjadi Owner.
- [ ] Secret key tidak ada di bundle, Git, network response, source maps publik, atau log.
- [ ] Signed URL privat memiliki masa berlaku singkat; listing publik ditolak.
- [ ] PIN disimpan dengan hash kuat; rate-limit dan cooldown diuji.
- [ ] File yang bukan gambar valid, file besar, koordinat invalid ditolak.
- [ ] Protected route tidak cukup: backend tetap menolak request tidak berwenang.
- [ ] Tidak ada SQL injection/XSS yang jelas, dependencies dan configuration diaudit.

### 14.3 Mobile QA

- [ ] Tuntas diuji di 320/360/375/390/412/430 px tanpa horizontal overflow.
- [ ] Tombol minimal 44 px, input tidak tertutup keyboard.
- [ ] Kamera & GPS berhasil di Android Chrome dan iOS Safari yang representatif, melalui HTTPS.
- [ ] Permission denied, timeout, mode pesawat, jaringan lambat, dan back navigation memiliki alur aman.
- [ ] Owner dashboard tetap terbaca di layar HP dan desktop.
- [ ] `prefers-reduced-motion`, focus, label, dan kontras memadai.

### 14.4 Engineering

- [ ] `npm run build`, lint, typecheck, dan test otomatis lulus.
- [ ] SQL migrations tersimpan dan dapat dijalankan ulang di environment baru.
- [ ] README setup & deployment lengkap namun ringkas.
- [ ] Perubahan schema/security diuji dengan skenario izin positif dan negatif.
- [ ] Tersedia rencana backup, retensi, cleanup foto orphan dan disaster recovery.
- [ ] Pemilik proyek menyetujui kebijakan data serta hosting produksi.

## 15. Urutan implementasi AI (jangan lompat)

**Fase 0 — Audit awal:** Periksa repository, baca AGENTS.md dan README, cek dependensi/branch/status Git. Jika repo kosong, buat scaffold minimal. Jangan menghapus file existing.

**Fase 1 — UI dengan mock data:** Bangun halaman karyawan, login Owner, dashboard Owner, semua state dan responsivitas. Jalankan build/typecheck dan validasi layar HP. Jangan membangun backend lebih dahulu sebelum UI kritis dapat digunakan.

**Fase 2 — Database & permission:** Buat SQL migrations, constraint, RLS, bucket privat, Owner provisioning. Uji negatif anon/non-owner. Tidak perlu memasukkan data asli.

**Fase 3 — Backend absensi:** Bangun PIN hashing, rate limit, sesi sementara, upload intent, validasi foto/GPS, transaksi masuk/pulang, idempotency, cleanup.

**Fase 4 — Integrasi UI:** Hubungkan React ke backend. Uji berbagai status/loading/error dan reconnect.

**Fase 5 — Dashboard Owner asli:** Baca data aman, lihat bukti privat, kelola karyawan dan PIN reset.

**Fase 6 — Security/QA & release:** E2E Android/iPhone, responsivitas, optimasi, audit, dokumentasi, verifikasi hosting/legal; deploy **hanya setelah persetujuan**.

Setelah menyelesaikan tiap fase: laporkan file diubah, keputusan penting, hasil command/test, risiko tersisa, dan langkah terdekat. Jangan mendeklarasikan fase selesai jika tes gagal.

## 16. Aturan hemat token untuk AI coding agent (WAJIB)

1. **Baca seperlunya:** Awali dengan `AGENTS.md`, `README.md`, tree singkat, dan file terkait tugas. Jangan membaca seluruh `node_modules`, `dist`, lockfile atau log panjang.
2. **Rencanakan perubahan kecil:** Sebutkan tujuan, file terdampak, dan uji yang relevan dalam 3–6 poin sebelum edit kompleks. Untuk perubahan sangat kecil cukup satu kalimat.
3. **Satu tugas satu fokus:** Jangan refactor area yang tidak diminta. Hindari overengineering dan penambahan fitur di luar MVP.
4. **Reuse dulu:** Cari komponen/fungsi yang sudah ada sebelum membuat baru. Hindari dependency baru jika native API atau util kecil mencukupi.
5. **Konteks terbatas:** Gunakan pencarian nama file/fungsi, inspeksi rentang baris terkait; jangan terus-menerus menampilkan file penuh.
6. **Patch terarah:** Edit hanya file/bagian relevan; jangan menulis ulang file besar untuk perubahan kecil.
7. **Output singkat:** Jangan menyalin ulang seluruh kode, SQL atau file AGENTS.md ke chat. Sebutkan ringkasan dan path file. Detail hanya ketika diperlukan.
8. **No repetition:** Jangan mengulang keputusan yang sudah tercatat di AGENTS.md dan percakapan. Jangan meminta kembali informasi yang sudah ditetapkan.
9. **Tes proporsional:** Jalankan unit test terkait dulu; build/typecheck setelah perubahan signifikan; full suite di akhir fase. Jangan mengulang tes identik tanpa perubahan.
10. **Error handling terstruktur:** Jika gagal, baca error spesifik, koreksi akar masalah, maksimal 2–3 percobaan dengan pendekatan sama; lalu evaluasi ulang dan laporkan blocker.
11. **Hindari prompt berantai panjang:** Bagi implementasi menjadi fase kecil yang berdiri sendiri, simpan progres di `TASKS.md` ringkas jika tugas multi-sesi.
12. **Jangan membuat laporan panjang otomatis:** Ringkasan per tahap idealnya maksimal ~8–12 baris kecuali pengguna meminta detail.
13. **Jangan generate dokumentasi duplikat:** `AGENTS.md` adalah spesifikasi; `README.md` untuk setup, `TASKS.md` untuk progres. Jangan membuat banyak file perencanaan serupa.
14. **Jangan hemat token dengan mengurangi keamanan:** Validasi input, RLS, hash PIN, rate limiting, test negatif, error handling, dan review keamanan **tidak boleh dilewatkan**.
15. **Jangan melakukan web browsing berulang tanpa alasan:** Periksa dokumentasi resmi untuk API yang berubah atau saat menemui error versi; catat keputusan dan lanjutkan.
16. **Jangan mengubah stack tanpa persetujuan:** Penambahan framework, layanan berbayar, atau penyimpanan data baru harus dijustifikasi dan disetujui.
17. **Simpan pekerjaan yang reproducible:** Gunakan lockfile, migration, env example, dan skrip npm yang jelas, supaya sesi AI berikutnya tidak perlu menebak.
18. **Stop setelah acceptance criteria tugas terpenuhi:** Jangan “memperindah” bagian lain, menambah animasi, atau melakukan optimasi spekulatif.

### Format laporan AI setelah task

```text
Selesai: <apa yang berubah, 1–2 kalimat>
File: <daftar path singkat>
Pengujian: <perintah dan hasil, atau alasan belum berjalan>
Keamanan: <dampak pada auth/RLS/data pribadi jika ada>
Berikutnya: <satu langkah terdekat>
Blocker: <hanya bila ada>
```

## 17. Aturan perubahan dan persetujuan

**Boleh dilakukan AI langsung dalam workspace pengembangan:** menambah/memperbaiki file lokal, mock UI, unit test, migrations sebagai file, dokumentasi, refactor kecil relevan, build dan lint lokal.

**Minta persetujuan eksplisit terlebih dahulu:** menjalankan perubahan pada database produksi, menghapus data/bucket/file, mengubah konfigurasi auth proyek aktif, membuat akun Owner dengan email riil, menambahkan layanan berbayar, membagikan akses, mempublikasikan foto/data, melakukan deployment produksi, rotasi secret, serta tindakan destruktif.

**Jangan pernah:** men-disable RLS untuk "memperbaiki" akses, memasukkan service key ke frontend, menyimpan PIN plaintext, membuat Owner publik via signup biasa, memakai `localStorage` untuk PIN, menjadikan bucket foto publik, atau mengabaikan kegagalan penyimpanan.

## 18. Risiko, asumsi dan keputusan belum final

| Topik | Default implementasi / tindakan |
| --- | --- |
| Jumlah karyawan | Asumsi kecil (2–30); desain tetap mendukung lebih banyak tanpa rewrite besar |
| Lokasi toko | Tidak digunakan untuk membatasi absensi; koordinat hanya dicatat |
| GPS akurasi | Simpan `accuracy_m`; tampilkan peringatan jika rendah, jangan diam-diam memalsukan data |
| PIN | Minimal 6 digit acak; hash kuat; rate-limit |
| Tanggal | WIB, tanggal pada saat masuk; pulang boleh lintas tengah malam dengan batas sesi |
| Foto | Diambil dari kamera, bucket privat, kompres sebelum upload |
| Retensi foto | Usulan 90 hari; **wajib disetujui Owner sebelum penghapusan otomatis** |
| Retensi riwayat | Usulan 12 bulan atau sesuai kebutuhan hukum/usaha; konfirmasi sebelum penghapusan |
| Hosting | Pastikan paket mengizinkan penggunaan bisnis, bukan otomatis Vercel Hobby |
| Internet mati | Tidak ada absensi offline; user harus retry dengan idempotency/status check |
| Koreksi data | Di luar MVP; jika diperlukan belakangan, wajib audit trail |
| Backup | Tentukan prosedur sesuai paket Supabase/hosting sebelum produksi |

## 19. Referensi teknis resmi (periksa versi terbaru sebelum implementasi)

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Edge Functions auth: https://supabase.com/docs/guides/functions/auth
- Supabase security checklist: https://supabase.com/docs/guides/security/production-checklist
- Supabase Storage signing: https://supabase.com/docs/guides/storage/security/signing-keys
- MDN Geolocation: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API
- MDN Camera getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Vercel Hobby terms: https://vercel.com/docs/plans/hobby

---

## 20. Perintah utama bagi AI saat mulai proyek

**Terapkan spesifikasi AGENTS.md ini secara bertahap. Mulai dari fase 0 dan fase 1: audit repository dan buat frontend React + Vite + TypeScript + Tailwind yang mobile-first dengan mock data serta seluruh state absensi dan dashboard Owner. Jangan membuat backend seolah sudah aman jika belum. Setelah itu laporkan file yang berubah, cara menjalankan, hasil build/test, dan fase selanjutnya. Saat membangun backend, prioritaskan RLS, verifikasi PIN di server, transaksi atomik, penyimpanan foto privat, dan uji keamanan negatif. Jangan menambah fitur di luar scope.**
