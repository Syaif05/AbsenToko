# Laporan Audit Stock Opname — Teh Idaman

Tanggal audit: **20 November 2026**. Ruang lingkup: alur Karyawan, Owner, API, validasi, ekspor, pencarian, dan skema database SO pada sumber kode lokal.

## 1. Ringkasan Eksekutif

**Penilaian: layak untuk uji operasional terpantau, tetapi belum ideal sebagai satu-satunya catatan stok yang harus dapat dipertanggungjawabkan.** Fondasi transaksi, pembatasan akses Owner, tanggal WIB, dan snapshot histori sudah baik. Prioritas sebelum pemakaian harian yang lebih serius adalah pemulihan draf, kepastian identitas pengisi, dan riwayat koreksi/penghapusan laporan.

Audit mencatat **16 temuan: 3 Tinggi, 10 Sedang, dan 3 Rendah**. Tidak ditemukan bukti celah Kritis dari kode yang diperiksa. Ini tidak berarti produksi telah tersertifikasi aman: konfigurasi database aktif, deployment, dan perangkat nyata tidak diuji ulang dalam audit ini.

| Prioritas | Temuan utama | Dampak |
| --- | --- | --- |
| Tinggi | K-01: draf hanya di memori | Puluhan isian hilang ketika refresh, dialog ditutup, atau sesi habis. |
| Tinggi | O-01: koreksi/hapus tanpa audit historis lengkap | Tidak dapat menelusuri nilai asli, alasan, dan seluruh perubahan. |
| Tinggi | S-01: pemilihan nama tidak memverifikasi identitas | Orang lain dapat membuka sesi atas nama karyawan dan mengirim SO. |
| Sedang | O-02 dan O-03: laporan paralel per toko dan klasifikasi pecahan | Owner dapat salah memilih laporan acuan atau melewatkan stok menipis. |
| Sedang | O-04 dan O-05: ekspor saat data berubah dan beban memori | Hasil bisa melewatkan/mengulang laporan; ekspor besar berpotensi membebani HP. |

### Metode dan batas pembuktian

- **Tidak mengubah kode aplikasi, migrasi, konfigurasi, atau data produksi.** Satu-satunya berkas baru adalah laporan ini. Tidak melakukan push atau deployment.
- Pemeriksaan statis mencakup seluruh sembilan berkas dalam `src/features/stock`, halaman Owner SO, pemasangan modal di portal karyawan, dialog/CSS bersama, utilitas tanggal/CSV, kedua Edge Function, migrasi SO, dan dependensi otorisasi/sesi.
- Membaca pengujian SQL SO serta unit test terkait. Menjalankan **13 unit test yang ada**, semuanya lulus, melalui `node --experimental-strip-types --test tests/unit/employee-portal.test.mjs tests/unit/owner.test.mjs`. Pengujian endpoint menggunakan mock RPC/Auth, sehingga **bukan bukti izin database produksi**.
- Menjalankan pemeriksaan tambahan **di memori**, tanpa berkas baru: 17 kasus validator frontend, 2 batas tanggal WIB, 6 pasangan pencarian typo/alias, serta simulasi penyaringan isian kombinasi saat reload. Semua menghasilkan perilaku yang dijelaskan dalam laporan.
- Tes SQL yang melakukan insert/update/delete **hanya dibaca, tidak dijalankan**. Tidak menjalankan build, migrasi, atau pengujian browser yang menghasilkan artefak. Tidak menguji beban atau melakukan percobaan penyalahgunaan terhadap layanan aktif.
- Temuan bertanda **terkonfirmasi dari kode** menunjukkan jalur implementasi yang jelas. Skenario concurrency, memori, dan keyboard yang belum direproduksi di lingkungan nyata disebut sebagai **risiko**, bukan insiden yang sudah terjadi.
- Folder lokal tidak memiliki metadata `.git`; karena itu audit tidak mengklaim kesamaan sumber lokal dengan commit/deployment produksi terkini.

### Jawaban langsung atas pertanyaan utama

| Pertanyaan | Hasil pemeriksaan |
| --- | --- |
| Klik Simpan berkali-kali? | Ref `submitting` dan `busy` membatasi pengiriman UI. ID percobaan dipertahankan untuk payload identik. Database memakai advisory lock untuk ID sama dan UNIQUE untuk karyawan+toko+tanggal. Tidak terlihat jalur normal yang menggandakan laporan karyawan yang sama. |
| Respons hilang setelah commit? | Retry dengan ID sama mengembalikan laporan tersimpan. Mengubah payload membuat ID baru; jika laporan pertama sudah tersimpan, UNIQUE menolak pengiriman kedua dan UI meminta muat ulang. Data kedua tidak otomatis menggantikan data pertama. |
| Refresh atau buka WhatsApp? | Refresh/menutup dialog menghilangkan draf. Berpindah aplikasi atau mematikan layar tidak selalu menghapus state, tetapi tab yang dibuang OS atau sesi kedaluwarsa dapat menghilangkannya. |
| SO pukul 22.00 WIB bergeser tanggal? | Tidak ditemukan kesalahan tersebut: tanggal baru dibuat dari waktu server yang dikonversi ke `Asia/Jakarta`. Pukul 22.00 WIB adalah 15.00 UTC pada tanggal yang sama. |
| SO melewati tengah malam? | Form bertanggal lama ditolak dengan konflik; perlu reload dan pemeriksaan ulang. Tidak otomatis dimundurkan tanggalnya. |
| Master diubah/dihapus? | Nama, kategori, satuan, toko, pengisi, dan panduan laporan lama memakai snapshot. Penghapusan item mengosongkan FK master, tidak menghapus baris laporan. |
| Dua karyawan melapor pada toko dan hari sama? | **Diizinkan** sebagai dua laporan berbeda. Belum ada penanda laporan acuan/final. |
| Karyawan menembak endpoint Owner? | Token karyawan tidak memenuhi autentikasi Supabase Auth Owner. Endpoint memeriksa `getUser` dan `owner_profiles`; tabel master juga dilindungi RLS. Tidak ditemukan bypass langsung dari jalur yang ditinjau. |
| Mengganti nama/tanggal di payload SO? | Pengisi/toko berasal dari sesi dan database. Tanggal baru wajib cocok dengan hari WIB server. Kelemahan berada pada penerbitan sesi pilih-nama, lihat S-01. |
| Rekap total stok kritis? | Saat ini ada label per item, bukan mesin agregasi stok per toko/periode. Ekspor berisi baris laporan dan teks jumlah; jangan menganggapnya saldo persediaan atau menjumlahkan semua laporan. |

### Kontrol yang sudah baik dan perlu dipertahankan

1. **Atomic save:** header dan seluruh detail disimpan dalam satu pemanggilan fungsi SQL. Kegagalan validasi item menggagalkan transaksi; UI baru menampilkan tersimpan setelah respons server. Bukti: [migrasi SO][sql], baris 193–206; [EmployeeStock][employee], baris 96–106.
2. **Idempotency dan constraint harian:** UNIQUE `(employee_id, store_id, report_date)`, advisory lock ID pengiriman, serta pengembalian receipt. Dua ID berbeda yang bersaing tetap dibatasi UNIQUE. Bukti: [migrasi SO][sql], baris 34–46 dan 163–169.
3. **Histori terpisah dari master:** snapshot dibuat saat submit dan digunakan untuk detail, salin WhatsApp, dan ekspor. FK item menggunakan `ON DELETE SET NULL`. Bukti: [migrasi SO][sql], baris 51–64 dan 198–201; [model][model], baris 45–64; [ekspor][export].
4. **Optimistic locking laporan Owner:** pembaruan mengunci baris dan membandingkan `updated_at`. Dua Owner yang mengedit versi laporan sama tidak diam-diam saling menimpa. Bukti: [migrasi SO][sql], baris 214–231.
5. **Batas akses berlapis:** lima tabel SO memakai RLS, role anon dicabut aksesnya, kebijakan authenticated memerlukan profil Owner, RPC privileged hanya dapat dieksekusi service role. Bukti: [migrasi SO][sql], baris 68–87 dan 235–240.
6. **Tidak terlihat sink XSS pada komponen SO:** teks dirender lewat JSX atau `textarea.value`, bukan HTML mentah. CSV mengutip sel dan mengamankan awalan formula; Excel diisi sebagai string, bukan objek formula. Bukti: [StockFields][fields], [model][model], [ekspor][export], [csvCell][csv], baris 28–31. Perlindungan ini tidak menyelesaikan manipulasi format WhatsApp pada S-02.

## 2. Daftar Temuan Masalah — Sisi Karyawan

### K-01 — Draf dapat hilang tanpa pemulihan

- **Tingkat risiko: Tinggi. Status: terkonfirmasi dari kode.**
- **Lokasi:** [EmployeeStock][employee], baris 16–29; [Dialog][dialog], baris 24–28; [AttendancePage][portal], baris 101–114, 182–187, dan 252–254.
- **Skenario:** karyawan mengisi 30 barang, lalu refresh, menekan ×/Escape, atau tab dibuang OS saat pindah aplikasi. Nilai hanya berada di `useState`; membuka modal kembali memulai state baru. Timer sesi induk juga dapat menutup SO karena tidak mempertimbangkan draf/busy internal modal.
- **Dampak:** pengisian ulang, risiko asal mengisi setelah frustrasi, dan ketidakpastian saat sesi berakhir berdekatan dengan commit. Berpindah aplikasi saja tidak pasti menghilangkan input; kehilangan terjadi bila halaman direkreasi atau komponen dilepas.
- **Solusi yang disarankan:** autosave draf dengan kunci karyawan+toko+tanggal+versi katalog, debounce singkat dan indikator tersimpan. Simpan nilai, catatan, metadata versi, serta ID percobaan; jangan menyalin token ke draf. Beri masa berlaku, isolasi antaridentitas, dan hapus setelah commit terverifikasi. Sediakan konfirmasi keluar bila draf berubah serta alur pulihkan setelah sesi diperbarui. Draf lokal bukan bukti laporan sudah terkirim.
- **Uji penerimaan:** isi 30 barang, refresh, tutup/buka modal, simulasi tab discard dan sesi habis; semua nilai dapat dipulihkan hanya oleh konteks identitas yang sesuai, tanpa membuat laporan ganda.

### K-02 — Reload membuang isian parsial dan dapat mempertahankan jumlah pada satuan yang berubah

- **Tingkat risiko: Sedang. Status: terkonfirmasi dari kode.**
- **Lokasi:** [EmployeeStock][employee], baris 42–45 dan 80–84; [model][model], baris 28–32; [migrasi SO][sql], baris 179–187.
- **Skenario A:** Gula sudah diisi `2` kardus, pcs masih kosong. Setelah error lalu “Muat ulang form”, pasangan tidak lolos `validQuantity(..., false)` sehingga seluruh isian barang itu dibuang, termasuk angka `2`.
- **Skenario B:** Owner mengubah satuan item dengan ID sama dari `pcs` menjadi `kardus`, tetap bertipe tunggal. Setelah konflik versi dan reload, angka `24` masih valid secara sintaks sehingga dipertahankan sebagai 24 kardus, tanpa konfirmasi perubahan makna.
- **Dampak:** kehilangan sebagian draf atau salah satuan. Penolakan versi katalog lama di backend sudah tepat; masalah berada pada rekonsiliasi frontend sesudahnya.
- **Solusi yang disarankan:** pertahankan input mentah, termasuk yang belum lengkap. Bandingkan metadata item versi lama/baru; tandai perubahan satuan/tipe dan minta pemeriksaan khusus sebelum kirim. Item yang dihapus dipisahkan sebagai draf tidak terpakai, bukan dibuang tanpa penjelasan. Terapkan alur sama ketika melewati tengah malam: jangan diam-diam mengganti tanggal atau makna isian.

### K-03 — Aksi isi massal mengubah “belum dihitung” menjadi “habis”

- **Tingkat risiko: Sedang. Status: terkonfirmasi dari kode.**
- **Lokasi:** [EmployeeStock][employee], fungsi `fillEmpty`, baris 69–77, serta baris 159–164.
- **Skenario:** karyawan baru menghitung Milky Series lalu menekan “Isi yang kosong dengan −”. Aksi berlaku pada **seluruh katalog**, termasuk kategori yang tidak sedang terlihat. Pcs Gula yang belum dihitung juga menjadi `-`. Setelah itu laporan dapat langsung dikirim tanpa ringkasan konfirmasi.
- **Dampak:** laporan lengkap secara teknis, tetapi barang yang belum diperiksa tercatat kosong. Karyawan tidak dapat mengoreksi sendiri setelah submit.
- **Solusi yang disarankan:** tampilkan konfirmasi ringkas berisi jumlah barang dan cakupan kategori, misalnya “Tandai 30 barang yang belum diisi sebagai stok habis?”. Tambahkan Undo sebelum submit. Ringkasan pra-kirim cukup menampilkan jumlah terisi/habis/belum diisi tanpa mengembalikan panduan panjang atau tombol angka.

### K-04 — Pesan validasi ringkas belum menjelaskan format salah pada barang terkait

- **Tingkat risiko: Rendah. Status: terkonfirmasi dari kode; dampak keyboard perlu uji perangkat.**
- **Lokasi:** [StockFields][fields], `CompactStockInput`, baris 28–48; [EmployeeStock][employee], baris 90–94 dan 155–157; [model][model], baris 25–32; [migrasi SO][sql], baris 118–138.
- **Skenario:** pengguna memasukkan `1,5`, `1 / 2`, tanda panjang `—` seperti placeholder, atau hanya satu kolom Gula. UI memberi border merah dan pesan umum, lalu memfokuskan paragraf error setelah daftar, bukan kolom pertama yang salah. Validator JS juga melakukan `trim()` yang lebih luas daripada `btrim()` SQL: `\t1\t` dapat lolos frontend tetapi ditolak backend.
- **Dampak:** pengguna harus menebak format atau mencari kembali input yang salah. Bukan alasan untuk menerima angka negatif atau simbol bebas.
- **Solusi yang disarankan:** tampilkan satu pesan singkat di bawah input yang sedang bermasalah dengan `aria-describedby`, fokus ke kolom terkait, dan samakan normalisasi frontend/server. Normalisasi variasi tanda kosong atau pecahan hanya jika maknanya tidak ambigu; jangan mengubah angka tidak valid menjadi nol. Tidak perlu menambahkan kembali “Panduan pengisian”.

### Matriks validasi dan tanggal

Hasil frontend berikut diuji di memori menggunakan fungsi yang ada. Perilaku SQL ditelusuri dari `so_values`/`so_status`; bukan hasil pengiriman produksi.

| Input | Perilaku saat ini | Penilaian |
| --- | --- | --- |
| `-5`, `#@` | Ditolak frontend dan aturan SQL. | Benar. |
| Spasi saja | Dianggap kosong; ditolak bila wajib, menjadi `unfilled` bila opsional. | Benar; tidak sama dengan stok habis. |
| `-`, `0` | Diterima, status `empty` bila komponen lain juga nol/kosong stok. | Benar menurut aturan saat ini. |
| `1.400` dan `1400` | Keduanya diterima, disimpan sebagai teks masing-masing. | Tidak dikonversi menjadi angka baku; ekspor jumlah bukan kolom numerik. |
| `1/4`, `1/2` | Diterima untuk satuan tunggal, status `low`. | Sesuai format yang diminta. |
| `2/4`, `01/2` | Validator menerima; SQL mengategorikan `ok`. | Tidak konsisten dengan pecahan senilai; lihat O-03. |
| `1/0` | Ditolak. | Benar. |
| Gula `2` kardus + pcs kosong | Ditolak, termasuk ketika seluruh form tidak wajib. | Kedua komponen harus lengkap; `2` + `0` diterima. |
| Gula kedua kolom kosong | Diterima hanya bila opsional. | Menjadi `unfilled`, bukan kosong stok. |
| `999999999999` | Diterima sebagai bilangan 12 digit. | Batas teknis ada, tetapi belum ada peringatan kewajaran jumlah. |
| `—` atau `−` | Berbeda dari hyphen ASCII `-`, ditolak jika diketik/ditempel. | Kandidat normalisasi input. Tombol isi massal sendiri memasukkan ASCII `-`. |
| `\t1\t` | Frontend menerima setelah trim; SQL tidak memangkas tab dengan `btrim()` default. | Normalisasi perlu disamakan. |
| 20 Nov 2026, 22.00 WIB | Utilitas frontend menghasilkan `2026-11-20`; SQL memakai konversi WIB eksplisit. | Tidak ditemukan mismatch UTC. |
| 21 Nov 2026, 00.00 WIB | Utilitas menghasilkan `2026-11-21`; form hari sebelumnya ditolak SQL saat pengiriman baru. | Aman dari backdate; UX pemulihan perlu diperbaiki. |

## 3. Daftar Temuan Masalah — Sisi Owner & Database

### O-01 — Tidak ada audit trail lengkap untuk koreksi, penghapusan, dan perubahan master

- **Tingkat risiko: Tinggi. Status: terkonfirmasi dari kode/skema lokal.**
- **Lokasi:** [migrasi SO][sql], baris 34–46 dan fungsi `owner_update_stock_opname`, baris 209–232; [ownerStock][data], baris 77–90; [StockReports][reports], baris 149–180.
- **Skenario:** Owner mengubah Gula dari 2 menjadi 20, lalu Owner lain mengoreksi menjadi 3. Hanya nilai terakhir, `updated_by`, dan `updated_at` tersedia. Jika laporan dihapus, header dan detail hilang lewat cascade. Tidak ada alasan wajib atau tabel revisi SO; audit pengelolaan karyawan yang sudah ada tidak otomatis mencakup SO.
- **Dampak:** sulit membedakan kesalahan input, koreksi sah, dan perubahan tanpa dasar. Snapshot master melindungi nama/satuan lama, tetapi **tidak melindungi nilai laporan dari koreksi Owner**. UI, salinan WhatsApp, dan ekspor tetap memakai nama pengisi awal tanpa penanda jelas bahwa nilai sudah dikoreksi.
- **Solusi yang disarankan:** log append-only dalam transaksi yang sama, berisi report/item ID, aksi, aktor terverifikasi, waktu server, nilai sebelum/sesudah, dan alasan. Untuk penghapusan operasional, pertimbangkan pembatalan beralasan yang menyimpan histori; penghapusan permanen tetap mengikuti kebijakan retensi yang disetujui. Tampilkan “Dikoreksi Owner” pada detail, ekspor, dan salinan yang relevan.

### O-02 — Lebih dari satu laporan harian per toko belum memiliki laporan acuan

- **Tingkat risiko: Sedang. Status: perilaku terkonfirmasi; kebutuhan aturan final merupakan keputusan produk.**
- **Lokasi:** [migrasi SO][sql], constraint baris 46 dan pencarian `existing_id` baris 184; [StockReports][reports], baris 91–93; [ekspor][export], baris 7–12; [panduan SO][dbreadme], baris 203–209.
- **Skenario:** Amel dan Isma mengirim SO toko sama pada tanggal sama. Keduanya sah karena UNIQUE menyertakan `employee_id`. Tidak ditimpa dan tidak ditolak. Daftar membedakan nama, tetapi belum menampilkan jam pengiriman, shift, status final, atau peringatan ada laporan lain.
- **Dampak:** Owner dapat mengira laporan kedua sebagai duplikasi teknis atau menjumlahkan kedua hitungan stok yang sebenarnya menggambarkan persediaan sama. Menjumlahkan stok antarhari juga tidak berarti saldo persediaan.
- **Solusi yang disarankan:** tetapkan dulu apakah SO berlaku per toko/hari, per shift, atau per petugas. Untuk kebutuhan sekarang, pertahankan seluruh pengiriman dan beri satu status “laporan acuan” yang dipilih Owner, serta tampilkan jumlah laporan pada toko/tanggal tersebut. Jangan otomatis menghapus atau menimpa laporan lain.

### O-03 — Status menipis membandingkan teks pecahan, bukan nilainya

- **Tingkat risiko: Sedang. Status: terkonfirmasi dari kode.**
- **Lokasi:** [migrasi SO][sql], `so_status` baris 108–116 dan `so_values` baris 128–134; [model][model], baris 25–32; [StockFields][fields], baris 59–61.
- **Skenario:** `1/2` diberi “Menipis”, sementara `2/4` atau `01/2` lolos validasi tetapi diberi `ok`/“Tercatat”. Nilai `1/8` juga bukan `low`. Untuk barang pcs, angka `1` tidak berarti stok aman; kode memang tidak memiliki batas minimum per barang.
- **Dampak:** indikator kritis dapat melewatkan stok rendah. Tidak ada perhitungan total stok kritis yang dapat diaudit karena saat ini fitur hanya memberikan label per item.
- **Solusi yang disarankan:** simpan teks asli dan bentuk numerik/rasional baku, lalu definisikan aturan jelas. Jika hanya `1/4` dan `1/2` yang boleh dipakai, validator harus konsisten membatasi atau mengkanonisasi pecahan ekuivalen. Jika ingin batas minimum, tetapkan per barang dan satuan; jangan menyimpulkan jumlah kardus+pcs tanpa faktor konversi yang disetujui.

### O-04 — Pagination ekspor tidak memberikan snapshot data yang stabil

- **Tingkat risiko: Sedang. Status: risiko concurrency berdasarkan implementasi; belum direproduksi dengan pengguna paralel.**
- **Lokasi:** [ownerStock][data], `reportsQuery` baris 14–20, `stockReports` baris 23–28, dan `stockExportRows` baris 44–52.
- **Skenario:** ekspor membaca offset 0–49. Laporan baru masuk di posisi awal sebelum pembacaan offset 50–99; salah satu laporan halaman pertama dapat terbaca lagi. Penghapusan pada halaman awal dapat menggeser satu laporan sehingga terlewat. Edit selama ekspor dapat mencampur versi sebelum/sesudah.
- **Dampak:** urutan sudah deterministik untuk dataset diam, tetapi tidak menjamin hasil konsisten selama perubahan. Pagination daftar juga dapat bergeser, meskipun dampaknya lebih kecil dibanding file arsip.
- **Solusi yang disarankan:** gunakan cursor berdasarkan seluruh kunci pengurutan dan batas waktu awal ekspor untuk mengurangi pergeseran. Untuk ekspor yang harus konsisten terhadap edit/hapus, gunakan snapshot server atau kumpulan ID+versi yang dibekukan. Cursor saja tidak menjamin konsistensi nilai yang sedang diedit. Sertakan waktu pembuatan ekspor dan jumlah laporan unik.

### O-05 — Ekspor semua tanggal menampung seluruh data di memori browser

- **Tingkat risiko: Sedang. Status: risiko kapasitas; tidak ada pengukuran crash dalam audit ini.**
- **Lokasi:** [ekspor][export], baris 7–27; [ownerStock][data], baris 44–52; [StockReports][reports], baris 43–56 dan 73–77.
- **Skenario:** Owner mengekspor beberapa tahun lewat “Semua tanggal”. Fetch memang bertahap 50 laporan, tetapi semua baris ditambahkan ke array, lalu workbook/buffer atau string CSV dibentuk lagi di browser. Sebagai ilustrasi kapasitas, 30 laporan/hari × 365 × 42 item menghasilkan 459.900 baris detail; ini bukan jumlah data aktual yang telah diukur.
- **Dampak:** memori tinggi, UI tersendat, dan kemungkinan tab dihentikan pada HP. Tidak ada batas keseluruhan, estimasi jumlah baris, progres terukur, atau tombol batal untuk pekerjaan ekspor.
- **Solusi yang disarankan:** estimasi jumlah laporan/baris sebelum mulai, batas ukuran dengan pesan jelas, dan ekspor per periode. Gunakan worker agar pemrosesan tidak menahan UI; untuk volume besar gunakan ekspor server/streaming. Jangan memotong data diam-diam. Pertahankan pembatalan jika satu halaman gagal agar tidak mengunduh file parsial sebagai lengkap.

### O-06 — Master dan pengaturan dapat saling menimpa antar-Owner/tab

- **Tingkat risiko: Sedang. Status: terkonfirmasi dari kode.**
- **Lokasi:** [ownerStock][data], `writeStockMaster`/`writeStockSettings`, baris 77–90; [StockMaster][master], baris 68–102 dan 125–140; [migrasi SO][sql], baris 3–31.
- **Skenario:** dua tab membuka item sama. Tab A mengubah satuan; tab B hanya bermaksud mengganti nama tetapi mengirim seluruh field lama. UPDATE hanya membandingkan ID, sehingga satuan baru dari tab A dapat tertimpa. Pola serupa terjadi pada checkbox wajib dan catatan WhatsApp.
- **Dampak:** kehilangan perubahan tanpa konflik yang jelas; perubahan versi katalog berikutnya menyulitkan karyawan yang sedang mengisi.
- **Solusi yang disarankan:** tambahkan versi/`updated_at` pada master dan pengaturan, conditional update dengan versi awal, serta pesan konflik yang menampilkan data terbaru. Terapkan audit O-01. Pola penguncian versi pada laporan Owner sudah ada dan dapat dijadikan acuan.

### O-07 — Filter yang terlihat dapat berbeda dari filter ekspor aktif

- **Tingkat risiko: Rendah. Status: terkonfirmasi dari kode.**
- **Lokasi:** [StockReports][reports], state `draft`/`filters` baris 15–16, `download` baris 49–50, dan form baris 62–84.
- **Skenario:** daftar sudah dimuat untuk November, Owner mengganti tanggal menjadi Oktober tetapi langsung menekan Unduh tanpa “Terapkan filter”. File tetap berisi November karena ekspor menggunakan `filters`, bukan `draft`. Jika filter diganti selama ekspor, pekerjaan yang berjalan juga tetap menggunakan filter saat dimulai.
- **Dampak:** file benar menurut query, tetapi berbeda dari ekspektasi yang dibentuk input yang terlihat. Tidak ada label rentang aktif yang cukup eksplisit.
- **Solusi yang disarankan:** tampilkan chip/ringkasan “Filter aktif”, tanda perubahan belum diterapkan, dan rentang pekerjaan ekspor yang sedang berjalan. Disable unduh saat draft filter belum diterapkan atau terapkan filter secara konsisten saat klik unduh.

### O-08 — Owner dapat mengosongkan laporan yang awalnya wajib lengkap

- **Tingkat risiko: Sedang. Status: perilaku terkonfirmasi; perlu keputusan kebijakan koreksi.**
- **Lokasi:** [StockReports][reports], baris 130–139; [migrasi SO][sql], baris 225–231; [model][model], baris 28–32.
- **Skenario:** aturan karyawan mewajibkan semua item. Owner menghapus isi beberapa atau seluruh kolom lalu menyimpan. Validator Owner selalu memakai `required=false`; SQL juga demikian. Laporan dapat berubah menjadi `unfilled` tanpa alasan wajib atau penanda laporan tidak lengkap di daftar.
- **Dampak:** standar kelengkapan berbeda antara pengiriman dan koreksi. Ini **bukan bypass akses**, karena dilakukan Owner sah, dan `unfilled` memang dibedakan dari `empty`.
- **Solusi yang disarankan:** tetapkan kebijakan eksplisit: koreksi tetap lengkap, atau pengosongan diperbolehkan sebagai pembatalan hitungan dengan alasan dan indikator tidak lengkap. Simpan aturan/versi saat laporan dibuat agar perubahan pengaturan masa depan tidak mengubah arti histori. Hubungkan dengan audit O-01.

### O-09 — Owner dapat membuat katalog aktif yang tidak bisa digunakan karyawan

- **Tingkat risiko: Sedang. Status: terkonfirmasi dari kode; bukan masalah pada katalog awal 42 barang.**
- **Lokasi:** [StockMaster][master], baris 43–45 dan 125–140; [ownerStock][data], baris 77–84; [EmployeeStock][employee], baris 88 dan 125–127; [migrasi SO][sql], baris 188–189.
- **Skenario:** Owner menambah/mengaktifkan item hingga 251 barang efektif, atau menonaktifkan seluruh kategori. Master menyimpan perubahan, tetapi seluruh karyawan tidak dapat mengirim SO karena aturan minimal satu/maksimal 250 barang.
- **Dampak:** konfigurasi sah pada layar Owner menyebabkan layanan pengisian berhenti untuk semua toko yang memakai katalog global.
- **Solusi yang disarankan:** tampilkan jumlah item efektif aktif serta dampak pengubahan kategori. Validasi batas di server dalam transaksi konfigurasi agar dua tab tidak melewati batas bersama-sama. Bila nol barang disengaja, beri status SO dinonaktifkan secara eksplisit.

### Catatan akurasi dan histori yang bukan bug

- Rename, pindah kategori, ubah satuan, nonaktifkan, atau hapus item **tidak mengganti snapshot laporan lama**. Kategori yang masih memiliki item ditolak penghapusannya oleh FK `RESTRICT`. Receipt dan ekspor memakai snapshot.
- Hapus toko membuat `store_id` laporan menjadi NULL dan mempertahankan `store_name`. Ini konsisten dengan mempertahankan histori SO. Apakah tindakan “hapus toko total” juga harus menghapus histori SO perlu diputuskan terpisah; audit ini tidak menganggapnya izin penghapusan data.
- Rentang tanggal memakai `gte`/`lte` pada kolom `date`, sehingga kedua batas inklusif dan tidak memerlukan konversi jam UTC. Default Owner memakai jam perangkat yang diformat WIB; jika jam perangkat salah, filter default bisa salah, tetapi tanggal penyimpanan baru tetap berasal dari server.
- Ekspor menampilkan jumlah sebagai teks beserta satuan. Belum ada agregasi stok numerik, faktor konversi kardus, penentuan saldo akhir, atau ringkasan kebutuhan pembelian. Angka stok antarbarang/satuan/laporan tidak boleh dijumlahkan begitu saja.
- Retry koreksi Owner setelah respons hilang tidak membuat duplikasi, tetapi dapat menghasilkan konflik versi karena commit pertama sudah berhasil. Setelah delete berhasil tetapi respons hilang, membuka detail kembali dapat gagal karena data sudah tidak ada. Perlu rekonsiliasi hasil dengan status operasi; jangan menyarankan retry tanpa batas atau menghapus pemeriksaan versi.
- Replay ID SO yang sudah tersimpan mengembalikan receipt tanpa membandingkan payload baru. UI membuat ID baru jika payload berubah, sehingga jalur normal terlindungi. Sebagai penguatan kontrak API, simpan fingerprint payload dan tolak pemakaian ID sama dengan isi berbeda; tidak ada bukti ini dapat mengubah laporan karyawan lain.

## 4. Temuan Keamanan & Celah Hak Akses

### S-01 — Sesi terikat karyawan, tetapi pemilik nama tidak diautentikasi

- **Tingkat risiko: Tinggi. Status: terkonfirmasi; merupakan keterbatasan desain pilih-nama yang disengaja.**
- **Lokasi:** [attendance-api][attendanceapi], operasi `stores`, `list`, dan `select_employee`, baris 88–119; [migrasi pemilihan karyawan][session], baris 64–79; [API karyawan][employeeapi], baris 86–99; [migrasi SO][sql], baris 155–184.
- **Skenario:** pengunjung memperoleh daftar toko/nama publik, memilih karyawan lain, lalu mendapat token sesi yang sah atas identitas itu tanpa PIN/kredensial/perangkat terikat. Ia dapat mengisi SO lebih dulu sehingga karyawan asli terkena batas satu laporan/hari. Ia juga dapat membuka laporan hari ini lewat `existing_id` identitas yang dipilih.
- **Dampak:** integritas atribusi dan kerahasiaan laporan harian tidak dijamin oleh pemilihan nama. SO tidak menambahkan bukti foto/lokasi atau verifikasi terpisah; jangan menganggap bukti absensi otomatis memverifikasi pengisi SO.
- **Batas temuan:** mengganti `employee_id`, nama, atau toko di payload `stock_save` **tidak** mengganti identitas server. Risiko muncul karena sesi baru atas nama orang lain bisa didapatkan melalui alur publik. Ini bukan eskalasi menjadi Owner dan bukan kegagalan pengikatan sesi pada RPC SO. AGENTS.md versi Teh Idaman memang menyatakan pemilihan nama tidak memverifikasi identitas.
- **Solusi yang disarankan:** jika SO menjadi dokumen operasional resmi, tambahkan verifikasi ringan yang disetujui Owner: PIN pribadi dengan rate limit, aktivasi perangkat terikat, atau autentikasi karyawan. Jangan membiarkan endpoint pilih-nama tetap menjadi jalur alternatif tanpa verifikasi setelah proteksi baru ditambahkan. Sampai itu diputuskan, label pengisi adalah identitas yang dipilih, bukan identitas terverifikasi.

### S-02 — Teks dapat mengubah struktur salinan WhatsApp

- **Tingkat risiko: Rendah. Status: terkonfirmasi dari kode; bukan eksekusi skrip.**
- **Lokasi:** [model][model], `whatsappStock`, baris 51–64; [StockFields][fields], baris 69–86; [migrasi SO][sql], constraint nama/satuan/panduan/catatan baris 3–44.
- **Skenario:** catatan memuat baris baru seperti `Nama SO: ...`, atau nama master memuat `*`, `_`, dan karakter kontrol. Semua diinterpolasi langsung ke teks WhatsApp sehingga dapat membentuk heading palsu atau merusak format. Input teks satu baris di browser mengurangi beberapa kasus, tetapi request API master Owner tidak dibatasi oleh tampilan HTML.
- **Dampak:** penerima salinan dapat salah membaca pengisi/nilai/catatan. React tetap meng-escape teks, sehingga tidak ada bukti stored XSS melalui jalur ini; CSV juga memiliki pengamanan formula.
- **Solusi yang disarankan:** sanitasi karakter kontrol pada nama/satuan, normalisasi format nama satu baris, dan pisahkan catatan bebas dengan delimiter serta prefix yang konsisten. Pertahankan baris baru yang memang dibutuhkan panduan. Cantumkan ID laporan agar teks eksternal bisa dicocokkan ke detail website.

### S-03 — Kuota global endpoint publik dapat mengganggu SO seluruh pengguna

- **Tingkat risiko: Sedang. Status: risiko ketersediaan dari kode; konfigurasi gateway aktif belum diverifikasi.**
- **Lokasi:** [attendance-api][attendanceapi], baris 38–40, 78–86, 110–112, dan 136–139.
- **Skenario:** semua operasi attendance-api, termasuk permintaan publik atau token salah, mengambil kuota `global` 300/menit sebelum autentikasi. Jika `TRUST_GATEWAY_IP` tidak aktif, tidak ada pembatas sumber pada jalur ini. Jika aktif, pembatas sumber membantu tetapi kuota global masih dipakai bersama untuk absensi, jadwal, dan SO.
- **Dampak:** lonjakan/penyalahgunaan endpoint publik dapat membuat penyimpanan SO sah menerima 429. Ini tidak membuka data, tetapi memperberat kondisi koneksi buruk dan pemulihan draf.
- **Solusi yang disarankan:** verifikasi sumber IP terpercaya pada gateway, pisahkan kuota publik dan sesi sah atau sediakan kapasitas cadangan, serta monitor 429 per operasi tanpa mencatat token. Tetap pertahankan batas global untuk perlindungan sumber daya. Jangan mempercayai `X-Forwarded-For` yang dapat diisi klien dan jangan menaikkan batas secara membabi buta.

### Pemeriksaan otorisasi, manipulasi payload, dan injeksi

| Jalur | Bukti kontrol pada sumber | Kesimpulan audit |
| --- | --- | --- |
| URL `/owner/stock-opname` | [OwnerRoutes][routes], baris 28–48 dan 84–95: pemeriksaan sesi/profil Owner sebelum halaman. | URL langsung tidak cukup untuk mendapatkan akses. Proteksi yang menentukan tetap backend/RLS. |
| `stock_edit` / `stock_delete` | [owner-api][ownerapi], baris 52–99: `getUser`, profil role Owner, UID dari token, validasi input dan pemanggilan RPC. | Token karyawan, pengguna Auth non-Owner, atau `owner_id` buatan tidak memberi hak Owner. Unit test negatif lulus pada mock. |
| CRUD master langsung | [migrasi SO][sql], baris 68–85: GRANT terbatas dan policy `USING`/`WITH CHECK` memeriksa `owner_profiles`. | Menghindari owner-api tidak otomatis menghindari RLS. Master memang ditulis via Data API; rate limit owner-api tidak berlaku pada jalur ini. |
| RPC privileged | [migrasi SO][sql], baris 235–240: EXECUTE dicabut dari PUBLIC/anon/authenticated. | SECURITY DEFINER dibatasi service role; jangan membuka grant ini untuk memperbaiki error UI. |
| Baca receipt karyawan lain | [migrasi SO][sql], baris 155–168: sesi aktif, employee ID dan current store dicocokkan. | ID laporan orang lain ditolak dalam sesi yang sudah terikat. S-01 tetap memungkinkan penyamaran melalui sesi baru. |
| Nama/toko palsu | [attendance-api][attendanceapi], baris 148–150; [migrasi SO][sql], baris 193–195. | Field identitas dari request tidak diteruskan; snapshot diambil dari database. |
| Backdate/future date | [migrasi SO][sql], baris 150, 187, dan 194. | Pembuatan baru wajib tanggal WIB server. Replay receipt lama bukan pembuatan laporan backdate. |
| SQL injection | Query melalui parameter RPC/PostgREST; SQL dinamis migrasi memakai daftar tabel tetap dan `%I`, bukan teks pengguna. | Tidak ditemukan konstruksi SQL SO yang menggabungkan input pengguna menjadi perintah. |
| XSS dan spreadsheet formula | JSX/textarea biasa; [csvCell][csv] baris 28–31; [ekspor][export] baris 17–27. | Ada perlindungan relevan pada jalur yang ditinjau; bukan audit seluruh sink XSS aplikasi atau seluruh pembaca spreadsheet. |

Tidak ada kunci rahasia yang diperlukan untuk menulis laporan ini. Audit tidak membaca isi secret environment atau menyalinnya ke laporan.

## 5. Evaluasi UX & Kemudahan Penggunaan

### Yang sudah sesuai kebutuhan sederhana

- Form karyawan sudah memakai **baris input ringkas**, satu kategori per tampilan, pencarian di awal, dan tidak menampilkan panduan atau tombol preset angka. Struktur ini sesuai permintaan terbaru, lebih pendek daripada screenshot lama.
- Pencarian berjalan lokal, tidak menunggu request jaringan, memakai normalisasi, prefix/substring, toleransi salah ketik, dan alias. Pemeriksaan aktual berhasil untuk `gual → Gula`, `royal chco → Bubuk Royal Choco`, `maciato → Bubuk Macchiato`, `yakul → Yakult`, `silen → Sealer Cup / Silen Cup`, dan `sp crim → Sp Cream`.
- Input dan kontrol utama memiliki tinggi minimal 44 CSS px; font input 1rem, nama item dapat membungkus, dan layout pasangan menggunakan kolom `minmax(0, 1fr)`. Bukti: [stock.css][css], baris 54–73; [CSS global][globalcss], baris 100–115.
- Dialog native, label programatis, status pencarian, `aria-invalid`, busy state, dan konfirmasi penghapusan Owner sudah tersedia. Tombol tutup tidak aktif ketika modal sedang menyimpan.

### Perbaikan interaksi yang paling berdampak

| Area | Evaluasi / risiko | Rekomendasi |
| --- | --- | --- |
| Pemulihan draf | K-01/K-02 paling mengganggu alur hitung nyata. | Indikator draf tersimpan, lanjutkan pengisian, dan konfirmasi keluar hanya jika perlu. |
| Keyboard HP | `type="text"` mendukung pecahan dan tanda `-`, tetapi membutuhkan pergantian keyboard. Toolbar/footer sticky berada dalam dialog `88dvh`; tidak ada bukti uji keyboard fisik pada audit ini. | Uji Gula dan item terakhir saat keyboard terbuka. Gunakan `inputMode` yang sesuai per jenis input tanpa menghilangkan akses ke `/` dan `-`, serta `enterKeyHint` untuk pindah isian. Jangan mengunci zoom. |
| Salah input | Error ringkas tidak menjelaskan format dan fokus jatuh ke paragraf, lihat K-04. | Fokus kolom salah pertama, pesan lokal singkat, dan pertahankan semua input. |
| Progress | Ada hitungan total, tetapi tidak ada progres per kategori atau filter “belum diisi”. | Badge `8/12` pada kategori dan opsi menampilkan barang belum diisi. |
| Isi massal | Efek berlaku di luar kategori yang terlihat. | Konfirmasi cakupan dan Undo; bukan mengembalikan tombol preset yang memenuhi layar. |
| Rekomendasi pencarian | Jika tidak ada match, UI menampilkan empat barang pertama kategori aktif. Itu **fallback katalog**, bukan rekomendasi yang relevansinya terbukti. | Bedakan label “Pilihan kategori ini” dengan “Mungkin yang dimaksud”; gunakan ambang skor untuk saran typo. Tetap tampilkan nama/satuan jelas agar barang serupa tidak tertukar. |
| Alias pencarian | Alias dikunci pada nama normalisasi; rename master dapat membuat alias lama tidak berlaku. | Bila diperlukan, kelola alias berdasarkan item ID dan simpan sinonim operasional, tanpa dependensi AI/network. |
| Edit Owner | Semua kategori terbuka dan memakai kartu input besar; belum mengikuti ringkasnya form karyawan. | Pencarian/kategori ringkas untuk koreksi, indikator item berubah, serta ringkasan sebelum simpan. |
| Transparansi koreksi | Detail tidak menunjukkan versi, jam koreksi, atau pelaku terakhir meski sebagian metadata tersedia. | Tampilkan waktu submit/koreksi WIB dan link riwayat audit, lihat O-01. |
| Rekap/filter | Belum ada filter toko/status kritis di SO; filter nama+tanggal ada. | Tambahkan filter toko dan stok habis/menipis setelah aturan laporan acuan jelas. |

### QA mobile yang masih harus dilakukan sebelum menyatakan tuntas

Uji lebar **320, 360, 375, 390, 412, 430, 768, 1024, dan 1440 px**, portrait dan landscape, di Android Chrome dan iOS Safari yang representatif. Periksa zoom, fokus, nama panjang, jumlah 12 digit, dua input Gula, textarea, tombol simpan, safe-area, dan keyboard yang terbuka. CSS menunjukkan mitigasi, tetapi audit statis tidak dapat membuktikan tidak ada tumpang tindih atau scroll horizontal pada semua perangkat.

Skenario penting: buka WhatsApp lalu kembali; layar terkunci; tab dimuat ulang oleh OS; jaringan putus sebelum/selepas commit; sesi habis ketika mengetik/menyimpan; pukul 23.59 menuju 00.00 WIB; master diubah ketika form terbuka. Pengujian ini belum dilakukan pada perangkat nyata dalam audit ini.

## 6. Rekomendasi Fitur Tambahan — Prioritas Tinggi ke Rendah

### Prioritas tinggi

1. **Autosave dan pemulihan draf yang terikat konteks.** Manfaat: menghindari penghitungan ulang. Gabungkan dengan rekonsiliasi perubahan katalog, peringatan sesi akan habis, serta pemeriksaan receipt sebelum retry. Kriteria selesai: 30 isian bertahan melalui refresh tanpa bocor ke identitas/toko lain.
2. **Audit revisi dan pembatalan laporan.** Manfaat: Owner dapat menelusuri koreksi dan mempertanggungjawabkan laporan. Rekam nilai sebelum/sesudah, alasan, pelaku dan waktu server; tampilkan histori ringkas. Log tidak boleh bisa diubah melalui jalur edit laporan biasa.
3. **Verifikasi identitas karyawan untuk SO resmi.** Manfaat: mengurangi pengiriman atas nama orang lain. Pilih mekanisme bersama Owner agar alur tetap ringan; penguatan harus mencakup seluruh jalur penerbitan sesi, bukan hanya layar SO.
4. **Laporan acuan toko/tanggal.** Manfaat: mencegah pemakaian beberapa hasil hitung sebagai stok gabungan. Tetapkan aturan per toko/hari atau shift; simpan laporan lain sebagai pembanding dengan status jelas.

### Prioritas menengah

5. **Ringkasan stok habis/menipis di dashboard Owner.** Gunakan laporan acuan terbaru, bukan penjumlahan seluruh laporan. Tampilkan jumlah barang, nama barang, toko, waktu hitung, dan tautan detail. Mulai dengan indikator dalam website; notifikasi eksternal hanya jika diminta dan dengan penerima/izin yang jelas.
6. **Peringatan selisih drastis dibanding hitungan sebelumnya.** Normalisasi pecahan, pertahankan item ID stabil, dan bandingkan hanya satuan/ukuran kemasan yang sama. Perubahan master, barang baru, dan laporan belum lengkap harus dikecualikan. Selisih hitungan bukan otomatis penjualan, kehilangan, atau kecurangan; tampilkan sebagai anomali yang perlu diperiksa.
7. **Ekspor yang konsisten, terukur, dan mudah dibatalkan.** Tambahkan filter aktif, laporan acuan, waktu snapshot, jumlah laporan/baris, indikator progres, dan batas volume. Ekspor numerik dipisah dari teks tampilan: jumlah utama, jumlah pcs, satuan, dan nilai asli. Jangan menjumlahkan kardus/pcs tanpa faktor konversi.
8. **Tinjau isian sebelum final dan koreksi melalui Owner.** Ringkasan ringan untuk jumlah barang habis/menipis/belum diisi, Undo isi massal, serta jalur meminta koreksi setelah terkirim. Hindari popup pada setiap barang.
9. **Progress kategori dan fokus ke barang bermasalah.** Manfaat langsung bagi karyawan tanpa memperbesar UI: kategori dengan hitungan selesai, filter belum diisi, dan navigasi ke error pertama.

### Prioritas lebih rendah

10. **Alias barang berdasarkan ID.** Nama lama, ejaan WhatsApp, dan istilah sehari-hari tetap dapat dicari setelah rename. Beri label kategori/satuan pada nama yang mirip.
11. **Ambang kewajaran per item.** Peringatkan angka sangat besar atau perubahan tidak biasa, tanpa langsung menolak stok sah. Ambang harus bisa dijelaskan dan disesuaikan dengan satuan operasional.
12. **Visibilitas operasional layanan.** Pantau proporsi gagal simpan, konflik versi, 429, durasi ekspor, dan penyelesaian draf secara agregat. Jangan merekam token, seluruh isi catatan, atau data pribadi dalam telemetry.

### Urutan implementasi dan gerbang QA yang disarankan

| Tahap | Fokus | Bukti selesai yang diperlukan |
| --- | --- | --- |
| 1 | K-01/K-02/K-03: draf, rekonsiliasi, Undo/konfirmasi | Uji refresh, logout/expiry, pindah aplikasi, perubahan satuan, dan midnight. Input parsial tetap dapat dipulihkan. |
| 2 | S-01/O-01: identitas dan histori | Uji negatif sesi milik orang lain, Owner/non-Owner, catatan revisi sebelum/sesudah, dan pembatalan beralasan. |
| 3 | O-02/O-03/O-08: aturan data operasional | Uji dua karyawan toko sama, pecahan ekuivalen, laporan kosong, dan pemilihan laporan acuan. |
| 4 | O-04/O-05/O-06: concurrency dan ekspor | Uji insert/delete/edit selama pagination, konflik dua Owner, pembatalan ekspor, dan volume realistis di HP. |
| 5 | Penyempurnaan UX/pencarian | Uji semua lebar yang diwajibkan, keyboard nyata, screen reader, alias, serta item/nama sangat panjang. |

### Cakupan pengujian yang sudah ada dan kekurangannya

[Tes SQL SO][sqltest] mencakup seed, tanggal WIB saat ini, field wajib, rollback jika item invalid, penolakan backdate, retry ID sama, constraint duplikat, receipt karyawan lain, non-Owner, privilege/RLS, snapshot setelah rename/delete item, konflik katalog, isian opsional, optimistic locking laporan, dan cascade detail. Script bergantung pada katalog awal 42 barang dan fixture Owner; gunakan database uji yang terkendali, bukan produksi yang master-nya telah berubah.

[Tes API karyawan][employeetest] dan [tes API Owner][ownertest] memeriksa forwarding identitas berbasis sesi, malformed values, role Owner, dan konflik versi. Pengujian yang berjalan dalam audit ini lulus **13/13**; dua test bernama khusus stock berada dalam kumpulan tersebut.

Belum ditemukan cakupan otomatis khusus yang membuktikan: persistensi draf, keyboard perangkat, dua transaksi SO benar-benar bersamaan, pergantian hari ketika form terbuka, pecahan ekuivalen pada SQL, konsistensi ekspor saat data berubah, dan histori koreksi. Pemeriksaan pencarian/validator di memori yang dilakukan dalam audit ini belum menjadi regression test tersimpan, sesuai larangan menambah berkas kode.

### Indeks sumber yang diperiksa

Semua tautan berikut menunjuk berkas lokal pada workspace audit; nomor baris dalam temuan mengacu pada versi yang dibaca tanggal audit.

- Frontend SO: [EmployeeStock][employee], [StockFields][fields], [StockMaster][master], [StockReports][reports], [model][model], [ownerStock][data], [exportStock][export], [searchStock][search], dan [stock.css][css].
- Integrasi: [OwnerStockPage][ownerpage], [AttendancePage][portal], [OwnerRoutes][routes], [Dialog][dialog], [CSS global][globalcss], [API karyawan][employeeapi], [API Owner][ownerclient], [tanggal WIB][dates], dan [CSV][csv].
- Backend/database: [attendance-api][attendanceapi], [owner-api][ownerapi], [migrasi SO][sql], [migrasi sesi pilih-nama][session], dan [panduan Supabase][dbreadme].
- Pengujian: [SQL SO][sqltest], [unit API karyawan][employeetest], dan [unit API Owner][ownertest].

[employee]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/EmployeeStock.tsx
[fields]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/StockFields.tsx
[master]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/StockMaster.tsx
[reports]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/StockReports.tsx
[model]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/model.ts
[data]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/ownerStock.ts
[export]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/exportStock.ts
[search]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/searchStock.ts
[css]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/stock/stock.css
[ownerpage]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/pages/OwnerStockPage.tsx
[portal]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/pages/AttendancePage.tsx
[routes]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/owner/OwnerRoutes.tsx
[dialog]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/components/ui/Dialog.tsx
[globalcss]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/styles/index.css
[employeeapi]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/attendance/api.ts
[ownerclient]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/owner/api.ts
[dates]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/attendance/dates.ts
[csv]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/src/features/owner/report.ts
[attendanceapi]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/supabase/functions/attendance-api/index.ts
[ownerapi]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/supabase/functions/owner-api/index.ts
[sql]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/supabase/migrations/20261120141942_stock_opname.sql
[session]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/supabase/migrations/20261111123220_direct_attendance_and_archives.sql
[dbreadme]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/supabase/README.md
[sqltest]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/supabase/tests/stock_opname.sql
[employeetest]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/tests/unit/employee-portal.test.mjs
[ownertest]: /Users/syaifulloh/Documents/Pemrograman/Program/AbsenTokoV2/tests/unit/owner.test.mjs
