# Embed Studio

Dashboard web untuk menyusun pesan embed Discord secara visual (warna, gambar unggahan, field, tombol, variabel seperti `{server.name}`), mengirim pesan, dan mengatur pesan **welcome / goodbye** otomatis. Setiap pengguna login menggunakan aplikasi Discord dan bot miliknya sendiri.

Application ID, Client Secret, dan Bot Token dimasukkan oleh pengguna pada layar login, divalidasi, lalu disimpan terenkripsi per akun. Kredensial pengguna tidak ditulis ke `.env` bersama dan bot website tidak menjadi fallback untuk tindakan dashboard.

Pengguna memulai dari halaman **Masuk / Daftar**. Pendaftaran cukup memakai email, password, dan konfirmasi password tanpa OTP. Nama dan nomor HP dapat dilengkapi nanti di profil. Setelah daftar atau login, pengguna memasukkan Application ID, Client Secret, dan Bot Token lalu menyelesaikan Discord OAuth. Akun website ditautkan ke identitas Discord saat OAuth berhasil, dan dashboard terbuka setelah bot tervalidasi. Password di-hash dengan scrypt; profil, hash, dan status verifikasi email disimpan di `loginpengguna.json`, sedangkan kredensial bot tetap terenkripsi per akun di `data/db.json`. Sesi yang dipilih **Ingat saya** disimpan di `data/sessions.json` hingga 30 hari. File akun dan sesi dikecualikan dari Git; jangan menghapus atau membagikannya.

Jika `npm start` gagal dengan `Unexpected end of JSON input` untuk `loginpengguna.json`, file akun kemungkinan kosong atau rusak. File kosong sekarang dapat memulai server sebagai penyimpanan akun baru, tetapi akun sebelumnya tidak bisa dipulihkan darinya; pulihkan file dari backup jika tersedia. File berisi JSON rusak yang tidak kosong tetap menghasilkan error agar tidak dianggap sebagai akun kosong.

## 1. Siapkan aplikasi di Discord Developer Portal
1. Buka https://discord.com/developers/applications → **New Application**.
2. Dari **General Information**, salin **Application ID**.
3. Buka **Bot**, buat/reset token, lalu salin **Bot Token**. Aktifkan **Server Members Intent** hanya jika akan memakai fitur welcome/goodbye.
4. Buka **OAuth2**, salin **Client Secret**.
5. Di **OAuth2 → Redirects**, tambahkan URL callback website ini: `http://localhost:3000/auth/callback` (saat online gunakan `https://domain-kamu.com/auth/callback`).
6. Di halaman login Embed Studio, masukkan Application ID, Client Secret, dan Bot Token tersebut. Setelah token divalidasi, lanjutkan login ke Discord. Jika login pertama, setujui akses identitas dan daftar server.

## 2. Jalankan
Butuh Node.js 20 atau lebih baru.

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
# isi BASE_URL, SESSION_SECRET, SMTP (untuk fitur pemulihan), dan CREDENTIAL_ENCRYPTION_KEY
# buat CREDENTIAL_ENCRYPTION_KEY: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm start
```
Buka http://localhost:3000, daftar dengan email dan password, lalu hubungkan aplikasi Discord pribadi sesuai panduan di halaman. Setelah dashboard terbuka, undang bot ke server tujuan dari tombol undangan.

### Konfigurasi email OTP
Reset password dan perubahan email membutuhkan server SMTP yang dapat mengirim email. Pendaftaran dan login tidak membutuhkan SMTP atau OTP. Isi `.env` pada mesin/server yang menjalankan Embed Studio:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alamat-pengirim@gmail.com
SMTP_PASS=password-aplikasi-email
EMAIL_FROM=Embed Studio <alamat-pengirim@gmail.com>
```

Gmail memerlukan **App Password** dengan verifikasi dua langkah aktif. Untuk provider lain, gunakan host, port, TLS, dan kredensial SMTP provider tersebut. OTP reset password berlaku 10 menit, maksimal lima percobaan verifikasi, dan permintaannya dibatasi. Kode OTP tidak pernah dikirim ke browser atau log aplikasi.

## Fitur
- Pendaftaran akun website langsung dengan email dan password tanpa OTP; nama lengkap dan nomor HP dapat diisi kemudian pada profil. Kepemilikan email tidak diperiksa saat pendaftaran, jadi pastikan alamat yang dimasukkan benar. Password di-hash dengan scrypt, login dan pendaftaran dibatasi percobaan, dan akun ditautkan ke Discord setelah OAuth berhasil.
- Jika lupa password, pilih **Lupa password?** di halaman masuk, masukkan email akun, lalu gunakan kode OTP dari email untuk menetapkan password baru. Kode berlaku 10 menit, maksimal lima percobaan, serta permintaannya dibatasi. Jawaban permintaan dibuat sama untuk email terdaftar maupun tidak terdaftar agar tidak membocorkan keberadaan akun. Untuk akun yang emailnya belum diverifikasi, reset juga mencabut sesi lama dan melepas koneksi bot agar pemilik email bisa menautkannya kembali.
- Halaman masuk mendukung penyimpanan login melalui password manager browser dan opsi **Ingat saya** untuk mempertahankan sesi. Password asli tidak disimpan di `loginpengguna.json` atau browser `localStorage`; server menyimpan hash scrypt, dan penyimpanan password di browser hanya terjadi jika pengguna menyetujuinya.
- Login email/password berikutnya memulihkan sesi, bot pribadi terenkripsi, dan pengaturan tanpa menghubungkan ulang. Opsi **Ingat saya** mempertahankan sesi hingga 30 hari. Dashboard menampilkan server tempat bot pribadi pengguna sudah bergabung.
- Tombol avatar di header membuka **Profil pengguna** dengan avatar Discord, nama lengkap, username Embed Studio, nomor HP, dan status email. Username, nama, serta nomor HP dapat diperbarui langsung; perubahan email baru aktif setelah OTP dikirim ke email tujuan dan diverifikasi, sedangkan perubahan password memerlukan OTP ke email akun saat ini dan konfirmasi password baru.
- Editor embed: author, judul + tautan, deskripsi, warna HEX, thumbnail, gambar besar, footer, timestamp, field, hingga 5 tombol tautan.
- Unggah gambar langsung (PNG/JPG/WEBP/GIF, maks 8 MB). Dikirim sebagai lampiran sehingga tetap tampil walau situs berjalan di localhost.
- Variabel: `{server.name}` `{server.id}` `{server.memberCount}` `{server.icon}` `{user.name}` `{user.mention}` `{user.id}` `{user.avatar}` `{channel.name}` `{channel.mention}` `{date}` `{time}` `{bot.name}`
- Pratinjau gaya Discord secara langsung.
- Template tersimpan per server.
- Welcome & goodbye otomatis, tersimpan di `data/db.json`.
- Pengiriman dari dashboard tersedia bagi pengguna yang login: atur 1–5 pesan, tempel ID channel, lalu klik **Kirim Pesan**. Pengaturan tersimpan per akun dan pengiriman memakai bot milik akun itu saja. Bot harus sudah bergabung ke server tujuan dan punya izin pada channel.
- Setiap bot pribadi otomatis menyinkronkan command global `/pesan`, `/infodaxia`, `/profiledaxia`, `/fp`, `/daxia` (slot, balance, daily, leaderboard, profile), `/daxia-help`, `/daxiayt`, serta menu konteks profil. Command muncul di server tempat aplikasi bot tersebut dipasang; propagasi command global Discord bisa memerlukan beberapa menit. `/pesan` memakai pesan dashboard milik pemilik bot tersebut.
- `/daxiayt` mengambil video terbaru channel YouTube [Ideologi Akal](https://www.youtube.com/@IdeologiAkal) melalui RSS publik, lalu menampilkan link, judul, deskripsi, tanggal, dan thumbnail di balasan command Discord. Command ini berjalan sendiri dan tidak bergantung pada pengiriman pesan dashboard atau command `/pesan`; feed dicache lima menit dan error jaringan ditampilkan dengan jelas.
- Tab **Command Dàxia** di setiap dashboard server mengatur teks dan warna balasan `/daxia` (slot, saldo, daily, leaderboard), `/infodaxia`, `/profiledaxia`, dan `/daxia-help`, serta hadiah daily, taruhan default/maksimum, pengali slot, dan tulisan/palet warna kartu GIF `/fp`. Pratinjau Discord di samping editor dapat dipilih per jenis balasan dan mengikuti perubahan teks, pengali, serta warna dengan nilai placeholder contoh. Tombol **Pratinjau GIF /fp** membuat kartu animasi dari pengaturan yang sedang diedit. Pengaturan tersimpan per server; placeholder balasan seperti `{balance}`, `{payout}`, `{userId}`, dan `{serverName}` dapat dipakai. `/pesan` tetap diatur dari tab **Atur /pesan**, sementara welcome/goodbye tetap di tab masing-masing.
- Command `/fp` mengirim satu file GIF animasi berukuran 960×540 dengan 16 frame, berisi kilau bergerak serta denyut pada bingkai dan cincin avatar. Kartu profil menampilkan statistik dua-kali-dua dan saldo di kanan atas, nama di tengah, serta tiga server teraktif di kanan bawah; Discord ID dan aktivitas channel per server tetap disertakan. Judul, label statistik, dan palet warna dapat diatur per server dari tab **Command Dàxia**. Balasan tidak memakai embed pembungkus atau tombol promosi. Avatar diunduh dalam ukuran kecil; jika CDN Discord tidak merespons dalam 6 detik, command menampilkan error yang jelas alih-alih terus menunggu. Jika riwayat harian belum pernah dicatat, angka periode ditampilkan sebagai `—`, bukan angka nol yang menyesatkan. Gunakan `/fp` untuk foto sendiri atau `/fp user:@nama` untuk memilih pengguna.
- Jika unggah gambar `/fp` ke channel ditolak Discord, bot mencoba mengirim kartu itu melalui DM; jika DM tidak bisa dikirim, embed error menyebutkan penyebab unggah dan DM sebenarnya. Error saat render juga menampilkan penyebab aslinya, bukan mengasumsikan izin channel bermasalah.
- Statistik `/fp` hanya mencakup pesan yang dilihat bot Dàxia saat bot aktif dan memiliki akses di server/channel tersebut; bot tidak dapat membaca aktivitas pengguna di seluruh Discord atau merekonstruksi pesan lama yang belum tercatat. Hitungan lifetime yang sudah tersimpan tetap dipakai; riwayat harian dan per-channel baru terkumpul setelah fitur tracking aktif. Bot menyimpan hitungan agregat tanpa batas waktu, nama server/channel, serta waktu pesan pertama/terakhir yang teramati, bukan isi pesan.
- Wallet game baru dimulai dari **Rp. 0**; nilai awal hadiah `/daxia daily` adalah **Rp. 1.000** setiap 24 jam dan dapat diubah per server. Wallet pengguna ID `1110287979525701632` mendapat saldo awal satu kali **Rp. 100 triliun per server**; flag di penyimpanan mencegah saldo awal tersebut dikreditkan lagi setelah transaksi atau restart.
- Saldo, taruhan, hadiah daily, hasil slot, dan leaderboard game Dàxia memakai format Rupiah ringkas (`ribu`, `juta`, `miliar`, `triliun`, `kuadriliun`). Nilai awal taruhan default adalah Rp. 100 dan batas maksimum Rp. 100 triliun; keduanya serta pengali hadiah slot dapat diatur per server. Nilai saldo dibatasi pada bilangan bulat JavaScript yang aman agar perhitungan tidak kehilangan presisi.
- Pesan bot dari dashboard, welcome/goodbye, dan balasan slash command menyertakan footer promosi serta tombol ber-emoji menuju [YouTube Ideologi Akal](https://www.youtube.com/@ideologiakal?sub_confirmation=1) dan [Discord Dàxia](https://discord.gg/XzTwxsSNRV).
- Embed Studio menyediakan dua tautan OAuth Discord langsung untuk aplikasi pribadi: **Undang bot ke server** (`scope=bot applications.commands`) memasang bot sebagai anggota server; **Tambah aplikasi ke akun pengguna** (`scope=applications.commands`, `integration_type=1`) memasang aplikasi/command ke akun tanpa memasukkan bot sebagai anggota. Penerima tautan tidak perlu login ke Embed Studio. Aktifkan **User Install** di Developer Portal → Installation untuk tautan akun pengguna.
- Kedua tautan adalah URL `https://discord.com/oauth2/authorize?...`, bukan URL lokal website, sehingga bisa disalin atau dibagikan dari ponsel lewat menu share, WhatsApp, SMS, dan aplikasi lain.
- Tautan server meminta izin **Administrator** sesuai panduan setup. Administrator memberi akses penuh di server; berikan hanya ke bot yang kamu percaya dan aplikasinya/token-nya kamu kendalikan. Administrator sebenarnya tidak wajib untuk pengiriman pesan: bila tidak ingin memberi izin penuh, undang bot dengan izin minimal **View Channel** dan **Send Messages** pada channel yang dituju.
- Bot Token dan Client Secret dienkripsi dengan AES-256-GCM. Isi `CREDENTIAL_ENCRYPTION_KEY` di `.env` dengan kunci acak 32-byte hex; pertahankan kunci yang sama saat restart/deploy karena token tersimpan tidak dapat didekripsi dengan kunci berbeda. Jangan ubah atau bagikan kunci ini.
- Pemilik website yang masuk dengan akun Discord yang tercantum di `OWNER_USER_IDS` dapat membuka **Pengaturan** untuk memantau CPU, RAM, disk, event loop, latency/error HTTP, uptime, dan koneksi bot pribadi secara live. Panel diperbarui tiap 5 detik; endpoint metrik hanya tersedia untuk pemilik.
- Pembuatan kartu `/fp` memakai paket `sharp` untuk merender dasar profil dan menghasilkan GIF animasi dengan jumlah frame dan resolusi yang dibatasi.
- `BASE_URL`, `PORT`, `SESSION_SECRET`, konfigurasi `SMTP_*`/`EMAIL_FROM`, `TIMEZONE`, allowlist, owner, dan kunci enkripsi adalah konfigurasi deployment website. Token bot setiap pengguna dimasukkan setelah pendaftaran email/password dan tidak disimpan di `.env`.
- `@everyone` / `@here` diblokir.

## Hosting
Frontend dan backend berjalan di satu proses Node.js; bot pribadi yang sudah dikonfigurasi tersambung melalui Gateway agar modul welcome/goodbye otomatis dapat berjalan. Untuk fitur tersebut, aktifkan **Server Members Intent** pada Developer Portal bot masing-masing. Proses harus hidup terus (PC menyala atau layanan hosting Node.js). Kalau memakai hosting gratis, cek apakah proses tidur otomatis dan apakah folder `data/` serta `uploads/` bersifat permanen. Jika tidak, kredensial bot, template, dan pengaturan bisa hilang saat restart.

Online: set `BASE_URL` ke alamat https situsmu dan daftarkan Redirect URI yang sama di Developer Portal.

## Opsional
`ALLOWED_USER_IDS` di `.env` membatasi siapa yang boleh login ke dashboard. Jika kosong, semua pengguna Discord yang dapat mengautentikasi melalui aplikasi mereka dapat login. `OWNER_USER_IDS` mengatur fitur owner-only pada dashboard; pengiriman selalu menggunakan bot pribadi milik pengguna yang login dan hanya ke server tempat bot tersebut bergabung.
