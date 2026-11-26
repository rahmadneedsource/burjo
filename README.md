# BUR JO’SS

Situs pemesanan untuk satu warung. Katalog awal mengikuti foto papan menu dan memakai foto makanan dari pemilik. Foto tambahan dapat diunggah melalui **Panel admin → Menu**.

## Menjalankan di komputer sendiri

Gunakan Node.js 22 atau lebih baru dan npm. Buka terminal di folder yang berisi `package.json`, lalu jalankan:

```sh
npm ci
```

Salin `.env.example` menjadi `.env.local`. Pada Windows PowerShell jalankan `Copy-Item .env.example .env.local`. Pada macOS atau Linux jalankan `cp .env.example .env.local`. Isi `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN`, lalu buat sandi panel:

```sh
npm run admin:hash -- "kata-sandi-pilihanmu"
```

Tempel hasilnya ke `ADMIN_PASSWORD_HASH` di `.env.local`. Isi juga `ADMIN_SESSION_SECRET` dengan string acak minimal 32 karakter. Lalu jalankan:

```sh
npm run dev
```

Buka `http://127.0.0.1:5173` untuk toko dan `http://127.0.0.1:5173/admin` untuk pengaturan. Isi nomor WhatsApp warung atau atur QRIS sebelum mencoba checkout. Skema tabel dibuat otomatis saat database pertama kali dipakai.

## Pemeriksaan

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Tes menggunakan database SQLite sementara, QR uji, dan respons pembayaran simulasi. Untuk uji GPS di perangkat, gunakan HTTPS dengan izin lokasi. Coba juga menolak izin dan mengisi alamat manual.

## Login panel admin

Panel memakai satu kata sandi yang disimpan sebagai hash PBKDF2-SHA-256 di variabel runtime `ADMIN_PASSWORD_HASH`. Sandi asli tidak pernah disimpan di database maupun di repositori.

1. Buat hash dengan `npm run admin:hash -- "kata-sandi"`.
2. Simpan hasilnya sebagai `ADMIN_PASSWORD_HASH` pada environment hosting.
3. Simpan `ADMIN_SESSION_SECRET` acak minimal 32 karakter. Kunci ini menandatangani cookie sesi.
4. Sesi berlaku 7 hari, cookie `HttpOnly` dan `SameSite=Lax`, serta memakai `Secure` di produksi. Tombol **Keluar** di panel menghapus sesi.
5. Mengganti sandi otomatis membatalkan semua sesi lama bila `ADMIN_SESSION_SECRET` diganti, atau langsung bila variabel itu dikosongkan.

Percobaan login dibatasi 8 kali per 15 menit per alamat IP. `LOCAL_ADMIN=yes` hanya membuka akses otomatis untuk `127.0.0.1`, `localhost`, dan `terminal.local` saat mode pengembangan; kosongkan di produksi.

## Penerapan produksi

Target aplikasi sekarang Vercel dengan database Turso (libsql). Foto yang diunggah disimpan pada tabel `shop_media` di database yang sama, sehingga tidak butuh bucket terpisah. Berkas `wrangler.local.json` hanya dipakai emulator lokal.

Alur deploy:

1. Buat database Turso dan catat URL serta tokennya.
2. Impor repositori ke Vercel.
3. Isi environment produksi: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `MIDTRANS_SERVER_KEY`, dan `MIDTRANS_MODE=production` bila pembayaran nyata.
4. Deploy. Skema tabel dibuat otomatis pada permintaan pertama.
5. Buka `/admin`, masuk dengan sandi, lalu isi **Pengaturan** sebelum membuka toko untuk pelanggan.

Jangan simpan `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, atau `MIDTRANS_SERVER_KEY` di kode. Deploy ulang setelah mengubah variabel runtime.

Notifikasi Midtrans memakai `https://<alamat-situs>/api/midtrans/notification`. Di situs privat, panel dan halaman status pelanggan tetap dapat menyinkronkan status lewat API Midtrans.

## Pengaturan awal

- Masukkan nomor WhatsApp pada **Pengaturan**. Pelanggan membuka WhatsApp dengan rincian pesanan dan mengirim pesan dari perangkatnya.
- Isi alamat dan jam buka, lalu aktifkan metode ambil sendiri atau antar. Pengantaran menggunakan ongkir tetap yang ditetapkan admin.
- Untuk QRIS Midtrans, akun merchant perlu memiliki QRIS pada Midtrans Core API. Untuk QRIS warung, lihat bagian berikut.
- Pastikan akses admin dan metode pembayaran sudah disiapkan sebelum membuka akses untuk pelanggan.

## QRIS warung

Di **Panel admin → Pengaturan → Pembayaran**, pilih **QRIS warung**, lalu masukkan QRIS statis resmi dari penyedia pembayaran warung. Admin dapat memilih gambar, menempel kode atau tangkapan layar, atau memindai melalui kamera. Bagian validasi menunjukkan nama dan kota merchant sebelum menyimpan.

Server mengisi nominal berdasarkan total pesanan, termasuk potongan dan ongkir. Pelanggan memindai atau mengunduh gambar QRIS di halaman status pesanan. Kode ini mengikuti pola konversi [qris-dinamis](https://github.com/verssache/qris-dinamis). Metode ini tidak meminta ID tagihan atau konfirmasi pembayaran dari penyedia.

Admin melihat pembayaran yang masuk melalui aplikasi penyedia, lalu menggunakan **Pesanan → Verifikasi Pembayaran** untuk mencatat referensi transaksi dan menandai pesanan lunas. Referensi yang sama tidak bisa digunakan untuk dua pesanan. Midtrans tetap bisa dipilih untuk verifikasi pembayaran otomatis.
