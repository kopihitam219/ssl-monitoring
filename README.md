# SSL Monitoring

Dashboard untuk memantau masa berlaku sertifikat SSL dari daftar domain resmi (**Source of Truth**). Daftarnya bisa diupload dari Excel, lalu ditambah, diubah, atau dihapus langsung di aplikasi.

Domain dikelompokkan ke **group dashboard** (contoh: Local, Public, Partner). Alert, hasil scan scheduler, dan info sistem bermasalah bisa dikirim ke **Microsoft Teams, Telegram, WhatsApp, Email, dan SOAR**.

Bisa dijalankan dengan dua cara (kodenya sama):

| Cara | Database | Dibuka dari | Scan dijalankan |
|---|---|---|---|
| **Lokal** (laptop / server kantor) | database lokal di folder `data/pg` (Postgres tertanam, tanpa server) | `http://127.0.0.1:3000` | komputer itu sendiri |
| **Cloud** (Vercel + Supabase) | Supabase | alamat Vercel, mis. `https://ssl-monitoring.vercel.app` | Vercel Cron, **atau** scanner kantor (laptop kantor yang menjalankan aplikasi ini dengan database Supabase yang sama) |

Lihat bagian **Deploy ke Vercel + Supabase** di bawah.

> Koneksi keluar hanya ke **domain yang dicek** (untuk membaca sertifikatnya), ke database (kalau memakai Supabase), dan ke layanan notifikasi / integrasi yang diaktifkan.

---

## 1. Kebutuhan

- **Node.js 22.13 atau lebih baru** (Node 22 LTS, 24 LTS, atau lebih baru). Cek dengan `node -v`.
- Git (untuk push/clone dari GitHub)

Tidak perlu install database, Docker, atau build tools.

## 2. Menjalankan

**Cara cepat (Windows):** ekstrak zip ke Downloads, lalu jalankan di PowerShell:

```powershell
Expand-Archive "$HOME\Downloads\ssl-monitoring.zip" "$HOME\Downloads" -Force
powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\ssl-monitoring\pasang.ps1"
```

`pasang.ps1` mengecek Node.js, menjalankan `npm install` dan `npm run build`, membuat shortcut **SSL Monitoring** di Desktop, lalu menjalankan aplikasi. Untuk menjalankan lain kali, klik shortcut itu (atau `jalankan.bat`).

**Database.** Tanpa pengaturan apa pun, data disimpan di database lokal `data/pg` (Postgres tertanam, tanpa server). Supaya laptop memakai Supabase (dan sekaligus menjadi *scanner kantor*), buat file `.env.local` berisi `DATABASE_URL=…` — lihat **Deploy ke Vercel + Supabase**. Data versi 2.0 (`data/real.db`, `data/app.db`, `data/settings.json`) dipindahkan otomatis saat start pertama.

> Dengan database lokal, hentikan aplikasi dulu sebelum menjalankan perintah terminal (`npm run scan`, `npm run reset-admin`, `npm run import-local`), karena database lokal hanya boleh dibuka satu proses.

**Cara manual:**

```bash
cd ssl-monitoring
npm install
npx next telemetry disable   # sekali saja per laptop
npm run dev                  # buka http://127.0.0.1:3000
```

Saat pertama kali dibuka, aplikasi meminta Anda **membuat akun Admin** (tidak ada password bawaan). Setelah itu Anda masuk lewat halaman login.

Biarkan terminal `npm run dev` tetap terbuka selama dashboard dipakai. Gunakan `127.0.0.1`, bukan `localhost`, karena di sebagian laptop Windows `localhost` tidak tersambung.

## 3. Login, peran, dan user

| Peran | Akses |
|---|---|
| **Admin** | Penuh: semua menu, termasuk Settings, Users, Restart service |
| **Monitoring** | Melihat Dashboard, SSL Inventory, Source of Truth. **Izin tambahan diatur admin** |

Admin mengatur izin tambahan untuk peran Monitoring di **Users → Hak akses peran Monitoring**. Pilihannya:

- Export / download Excel (default: aktif)
- Sync Now & cek ulang domain
- Tambah, ubah, hapus domain & upload Excel
- Lihat & jalankan Jobs
- Lihat Audit Log
- Lihat Health Check

Perubahan izin langsung berlaku untuk semua user Monitoring, tanpa perlu login ulang.

**Menu Users** (khusus admin) bisa dipakai untuk:

- Tambah user dengan peran Admin atau Monitoring.
- Ubah nama dan peran.
- Nonaktifkan akun (user langsung keluar).
- Reset password, dengan opsi *wajib ganti saat login*.
- Hapus user.

Setiap user bisa mengganti password sendiri lewat ikon kunci di bagian bawah sidebar.

Keamanan yang sudah diterapkan:

- Password disimpan dalam bentuk hash scrypt, tidak pernah dalam bentuk asli.
- Password minimal 8 karakter dan harus berisi huruf serta angka.
- Sesi login berlaku 12 jam, disimpan di cookie `httpOnly`.
- Akun dikunci **5 menit setelah 5x salah password**.
- Admin tidak bisa menghapus atau menurunkan perannya sendiri, dan selalu ada minimal satu admin aktif.

**Lupa password admin?** Kalau masih ada admin lain, minta dia me-reset. Kalau tidak ada sama sekali, jalankan `npm run reset-admin -- admin PasswordBaru123` di terminal laptop tersebut.

### Login dengan Microsoft Entra ID (Azure AD)

User bisa **login dengan akun Microsoft kantor**, dan **perannya diambil dari grup di Entra ID**:

- Anggota grup Admin menjadi **Admin**. Kalau seseorang ada di kedua grup, Admin yang dipakai.
- Anggota grup Monitoring menjadi **Monitoring**, dengan izin sesuai pengaturan Users → Hak akses.
- Anggota kedua grup **di-sync ke menu Users**, termasuk anggota grup bersarang. Sync bisa manual (Settings → Integrasi → Entra ID → *Sync user sekarang*, atau Jobs → *Sync user Entra ID*) atau otomatis setiap scan terjadwal.
- User yang **keluar dari grup** atau **dinonaktifkan di Microsoft 365** otomatis dinonaktifkan dan sesinya langsung diputus.
- User yang **dinonaktifkan manual oleh admin** aplikasi tetap nonaktif walaupun login lewat Microsoft, sampai admin mengaktifkannya lagi.
- Peran dan password user Microsoft tidak bisa diubah di aplikasi, karena dikelola di Microsoft 365.
- **Login lokal tetap tersedia** sebagai akun cadangan, misalnya akun `admin` lokal.

**Persiapan** (oleh admin Microsoft 365, sekali saja):

1. **entra.microsoft.com → App registrations → New registration**. Pilih *Single tenant*.
2. **Redirect URI**: platform **Web**, isi persis seperti yang tampil di Settings, misalnya `http://localhost:3000/api/auth/microsoft/callback`. Buka aplikasi dengan alamat yang sama dengan Redirect URI.
3. Catat **Application (client) ID** dan **Directory (tenant) ID**.
4. **Certificates & secrets → New client secret**, lalu salin *Value*-nya.
5. **API permissions → Microsoft Graph → Application permissions**: `User.Read.All` dan `GroupMember.Read.All`, lalu klik **Grant admin consent**.
6. Siapkan dua grup Security, misalnya `SSL-Monitoring-Admin` dan `SSL-Monitoring-Viewer`, lalu catat **Object ID**-nya.
7. Di aplikasi: **Settings → Integrasi → klik ikon Entra ID**, isi semua nilai, klik **Simpan**, lalu **Tes koneksi**, centang **Aktifkan**, dan **Simpan** lagi.

Tombol **Masuk dengan Microsoft** muncul di halaman login setelah diaktifkan. Client secret disimpan di database (tabel pengaturan) dan tidak pernah ditampilkan lagi. Secret Microsoft punya masa berlaku, jadi perbarui sebelum habis. Semua login, sync, dan tes koneksi tercatat di Audit Log.

> Kalau laptop kantor memakai proxy, jalankan dengan `$env:HTTPS_PROXY="http://proxy.kantor:8080"; $env:NODE_USE_ENV_PROXY="1"; npm start` supaya bisa mencapai `login.microsoftonline.com` dan `graph.microsoft.com`.


## 4. Dashboard

Menu **Dashboard** punya beberapa tab di bagian atas (pilihan terakhir diingat di browser):

- **Dashboard Utama**: 7 kartu status, donut status, tren, distribusi environment, status data source, aktivitas, dan SSL Inventory (semua group).
- **Dashboard Monitoring**: tampilan ringkas untuk layar monitoring: 7 kartu status + **Renewal** (sertifikat yang diperbarui dalam 30 hari terakhir), lalu **satu panel per group** dengan donut dan tabel jumlah per status. Klik kartu atau baris tabel untuk membuka SSL Inventory yang sudah terfilter.
- **Tab per group** (nama tab = nama group, mis. *Local*, *Public*, *Partner*):
  - info group: jumlah file, jalur cek (tanpa / dengan proxy), upload terakhir, scan terakhir, tombol **Export Excel**;
  - tombol **Scan dashboard ini**, **Retry Check Failed**, dan **Tes koneksi Check Failed** (hanya untuk domain di group itu);
  - kartu Total + 7 status, donut, daftar **akan habis ≤ 30 hari**, jumlah per environment;
  - chip status (*Semua, Check Failed, Urgent Renewal, …*) untuk menyaring tabel domain di bawahnya.

## 5. Source of Truth: file Excel

Buka menu **Source of Truth**. **Tiap file Excel adalah satu sumber data** dengan dashboard sendiri. Semua file dipantau bersama.

**Daftar file.** Menampilkan nama file, jumlah domain, jumlah domain bermasalah, pilihan proxy, dan kapan terakhir diubah. Aksi per file:
- 👁 **Lihat & ubah isi**: tabel di bawah menampilkan isi file itu. Di sana Anda bisa **tambah, ubah, dan hapus domain**.
- **Download Excel terbaru**: mengunduh isi file saat ini (termasuk perubahan dari aplikasi) dengan nama file aslinya, dalam format template. File ini bisa diupload ulang kapan saja.
- **Upload ulang**: ganti / gabungkan isi file itu dengan file Excel baru.
- **Ganti nama** (nama dashboard ikut berubah).
- **Hapus file**: file beserta semua domain dan riwayat scan-nya dihapus permanen (ketik `HAPUS` untuk konfirmasi).
- **Proxy**: ubah langsung lewat dropdown di kolom Proxy.

**Upload Excel.** Kolom wajib hanya `Domain`. Kolom opsional: `Environment`, `Application`, `Owner`, `Port`, `Notes`. Template kosong tersedia lewat tombol *Template kosong*. URL lengkap seperti `https://app.co.id/login` otomatis dibersihkan. Saat upload cukup pilih dua hal:
  - **Group dashboard** tujuan (mis. Local / Public / Partner);
  - **Tanpa proxy** atau **Dengan proxy** (lihat di bawah).

  Nama file = nama sumber (tanpa `.xlsx`). Kalau nama file sudah ada, isinya **diganti** dengan isi file baru (domain yang tidak ada lagi di file dikeluarkan). Setelah upload, sertifikat langsung dicek otomatis.

**Group dashboard.** Di bagian atas halaman: tambah, ganti nama, atau hapus group (Local, Public, Partner sudah dibuat otomatis). File dipindah ke group lain lewat kolom **Group** di daftar file. Menghapus group tidak menghapus file-nya (file jadi *Tanpa group*).

**Buat file kosong.** Untuk mengisi domain langsung dari aplikasi tanpa upload Excel.

**Tambah domain.** Pilih file tujuan, isi domain. Sertifikatnya langsung dicek setelah disimpan.

**Pindah file.** Saat mengubah domain, pilih file lain di kolom *File Source of Truth* untuk memindahkannya.

**Ubah.** Klik ikon pensil. Kalau domain atau port diganti, domain langsung dicek ulang.

**Hapus domain.** Klik ikon tempat sampah, atau centang beberapa domain lalu klik *Hapus terpilih*. Domain yang dihapus tidak dipantau lagi (riwayat scan tetap tersimpan) dan bisa dikembalikan di **Settings → Domain yang dihapus**.

Domain yang sama boleh ada di beberapa file; masing-masing dipantau di file-nya sendiri.

### Pilihan proxy per file

| Pilihan | Cara cek |
|---|---|
| **Tanpa proxy** (default) | Dicek langsung. Kalau hasilnya **Check Failed**, otomatis dicek ulang **lewat proxy**. Kalau lewat proxy berhasil, hasil itu yang dipakai dan domain diberi tanda **proxy (otomatis)**. Kalau dua-duanya gagal, pesan error menampilkan alasan keduanya. |
| **Dengan proxy** | Semua domain di file itu dicek lewat proxy. |

Proxy diisi di **Settings → Proxy untuk cek SSL**. Selama proxy belum diisi, semua domain dicek langsung (tanpa percobaan ulang). Cara cek terakhir tiap domain terlihat di tabel (tanda *proxy* / *proxy (otomatis)*), di detail domain, di riwayat cek, dan di kolom *Cek lewat* hasil Export.

## 6. Jobs dan Restart service

Buka menu **Jobs**. Pilih **group** di kanan atas untuk membatasi Scan / Retry / Tes koneksi ke satu group (default semua group).

- **Scan SSL**: cek sertifikat semua domain. Sama dengan tombol *Sync Now* dan scan otomatis.
- **Retry Check Failed**: scan ulang **hanya** domain yang statusnya Check Failed. Lebih cepat daripada scan semua.
- **Tes koneksi Check Failed**: untuk tiap domain Check Failed dijalankan **DNS → Ping → Telnet (port) → Curl (HTTPS)**, langsung dan lewat proxy. Hasilnya tampil di bawah nama domain di tabel (mis. `Tes koneksi: DNS ✓ · Ping – · Port 443 ✗ · HTTPS ✗ · Proxy 200`) dan lengkap di detail domain, dengan kesimpulan seperti *"Port 443 tidak bisa dijangkau (timeout) — kemungkinan diblokir firewall. Lewat proxy bisa → …"*.
- **Kirim notifikasi sekarang**: kirim ringkasan status saat ini ke semua saluran yang menerima *Hasil scan*.
- **Tes koneksi manual** (di bawah daftar job): ketik domain/IP dan port, klik **Tes**. Di detail domain juga ada tombol **Tes koneksi**.
- **Restart ringan**: memuat ulang database dan pengaturan, menjalankan ulang scheduler, dan mereset scan yang macet lebih dari 15 menit. Server tetap menyala.
- **Restart service**: server dimatikan lalu dinyalakan lagi otomatis dalam 5–20 detik. Bekerja kalau aplikasi dijalankan dengan `npm run dev` atau `npm start`.

Semua run (manual, otomatis, terminal) tercatat di **Riwayat job**. Catatan: banyak server/firewall memblokir ping (ICMP); kalau port & HTTPS berhasil, ping gagal bukan masalah.

## 7. Health Check

Menu **Health Check** (admin, atau Monitoring yang diberi izin) menampilkan, dan diperbarui otomatis tiap 5 detik:

- **CPU, RAM, Disk**, dan **memori aplikasi**, dengan grafik 5 menit terakhir. Status *Perhatian* di ≥ 85% dan *Bermasalah* di ≥ 95%.
- **Status service**: web server, database domain & aplikasi (termasuk waktu respons), scheduler (jadwal scan berikutnya), scan engine (termasuk deteksi scan macet), proxy, Wazuh (antrean & kiriman terakhir), SOAR → aplikasi, Microsoft Entra ID, dan tiap saluran notifikasi (kiriman terakhir berhasil / gagal).
- **Info sistem**: nama komputer, OS, berapa lama komputer dan aplikasi sudah menyala, versi Node.js, dan ukuran data aplikasi.

## 8. Audit Log

Menu **Audit Log** mencatat semua kejadian secara permanen: siapa, kapan, apa, dan nilai **sebelum → sesudah** (klik baris untuk melihat detail). Ada dua tab:

- **Aplikasi**: aksi pengguna, misalnya login dan logout (termasuk login gagal atau terkunci), tambah/ubah/hapus domain, upload Excel, perubahan Settings dan hak akses, kelola user, pindah mode, kosongkan data, run job, restart service, export, dan perintah terminal.
- **Sistem**: aksi otomatis, misalnya service menyala, scan terjadwal, kirim Teams otomatis, migrasi data, dan error.

Bisa difilter per kategori, sumber, hasil, dan tanggal, lalu di-**Export** ke Excel. Audit disimpan di database (tabel `audit_log`) dan tidak ikut terhapus saat data dikosongkan. Tidak ada tombol hapus audit di aplikasi. Webhook URL, password, dan API key tidak pernah dicatat isinya.

## 9. Notifikasi (Teams, Telegram, WhatsApp, Email, SOAR)

Di **Settings → Integrasi** ada deretan ikon: **WhatsApp, Telegram, Email, SOAR, Wazuh, Entra ID, Microsoft Teams**. Tiap ikon menunjukkan status (*Aktif / Mati / Belum diatur*); klik ikon untuk membuka halaman pengaturannya. Isi pesan (status yang di-alert, kirim ulang tiap N jam) diatur di **Settings → Isi notifikasi**. Ada tiga jenis pesan, dan **tiap saluran memilih sendiri** jenis yang diterima (centang *Terima: Alert SSL / Hasil scan scheduler / Info sistem bermasalah*):

| Jenis | Isi | Kapan dikirim |
|---|---|---|
| **Alert SSL** | domain dengan status yang dipilih (default *Check Failed* & *Urgent Renewal*) + domain yang sudah pulih | setelah setiap scan; domain yang sama hanya dikirim lagi kalau statusnya berubah atau tiap N jam (default 24) selama masih bermasalah |
| **Hasil scan scheduler** | ringkasan jumlah per status + daftar domain bermasalah | setiap scan otomatis (scheduler), juga lewat *Jobs → Kirim notifikasi sekarang* |
| **Info sistem bermasalah** | scan gagal / macet, database bermasalah, CPU / RAM / Disk ≥ 95%, saluran notifikasi gagal kirim — dan pesan *Sistem kembali normal* saat pulih | dicek tiap 5 menit; masalah yang belum pulih diingatkan tiap N jam (default 6) |

Saluran:

| Saluran | Yang diisi |
|---|---|
| **Microsoft Teams** | Webhook URL (channel → **⋯ → Workflows** → template *"Post to a channel when a webhook request is received"*) |
| **Telegram** | Bot token (dari **@BotFather**) dan Chat ID (grup: mis. `-1001234567890`; bot harus sudah ditambahkan ke grup) |
| **WhatsApp** | **Fonnte**: token device + nomor / ID grup tujuan (pisahkan koma). **Webhook gateway**: URL gateway WA kantor; aplikasi mengirim POST JSON `{target, message, type, title, …}` dengan header `Authorization` = token |
| **Email (SMTP)** | Server, port (587 STARTTLS / 465 SSL), username, password, pengirim, penerima (boleh banyak, pisahkan koma). Office 365: `smtp.office365.com:587`; Gmail: `smtp.gmail.com:587` + App Password |
| **SOAR (webhook)** | URL webhook (mis. API Trigger workflow Rapid7 InsightConnect), nama header & nilai API key. Isi kiriman JSON: `{source, host, type, level, title, summary, sections:[{title, items:[{domain, port, status, days_remaining, expires_at, group, file}]}]}` |

Langkah: klik ikon saluran → isi data → centang **Aktifkan** → pilih jenis pesan → **Simpan** → **Kirim tes**. Token, password, dan webhook URL disimpan di database (tidak ikut ke GitHub), tidak pernah ditampilkan utuh, dan di Audit Log hanya tertulis "(diisi)". Setiap kiriman (berhasil / gagal) tercatat di Audit Log kategori *Notifikasi*.

**Kalau kantor memakai proxy**, Node.js perlu diberi tahu supaya bisa mencapai layanan notifikasi (butuh Node 24 atau lebih baru):

```powershell
$env:HTTPS_PROXY="http://proxy.kantor:8080"; $env:NODE_USE_ENV_PROXY="1"; npm start
```

Email lewat SMTP kantor (jaringan internal) biasanya tidak perlu proxy.

## 10. Integrasi Wazuh

Klik ikon **Wazuh** di **Settings → Integrasi**. Aplikasi bisa mengirim log ke **Wazuh** dalam format JSON:

| Jenis (`log_type`) | Isi |
|---|---|
| `security` | login berhasil/gagal, akun terkunci, tambah/ubah/hapus user, reset password, perubahan pengaturan, API key SOAR baru, request SOAR dengan API key salah, kiriman / perintah dari SOAR, export data, kosongkan data, restart service |
| `app` | tambah/ubah/hapus domain, upload Excel, job & scan |
| `ssl` | temuan sertifikat setelah scan dengan status yang dipilih (default Check Failed, Urgent, Reminder; sertifikat yang sudah lewat tanggal dikirim sebagai `EXPIRED`), serta "kembali normal" |

Setiap event membawa `src_ip` (IP pengirim request), `actor`, `action`, `outcome` (success/failure), `severity`, `summary`, dan untuk SSL: `domain`, `port`, `ssl_status`, `days_remaining`, `expires_at`, `issuer`, `group`, `file`.

### Cara kirim

- **Wazuh API** (Wazuh 4.6+): langsung ke Wazuh manager lewat `POST /events` di port 55000. Aplikasi login dengan user API Wazuh (token JWT diperbarui otomatis), atau memakai **API key / Bearer token tetap** kalau ada API gateway di depan Wazuh. Batas Wazuh (100 event per request, 30 request per menit) sudah diperhitungkan.
- **File + Wazuh agent**: event ditulis ke `data/logs/ssl-monitoring-wazuh.json` (satu JSON per baris), dibaca Wazuh agent yang terpasang di laptop ini. Tidak tersedia di Vercel (pakai Wazuh API).
- **Keduanya**.

Event masuk **antrean** (tabel `wazuh_outbox`) dulu. Kalau Wazuh sedang tidak bisa dihubungi, event disimpan dan dikirim ulang otomatis (jeda 10 detik s/d 5 menit). Status antrean terlihat di Settings dan Health Check.

### Langkah di Wazuh (sekali saja)

1. **Buat user API khusus** yang hanya boleh mengirim event (`event:ingest`). Lewat dashboard: *Server management → Security* → buat Policy, Role, dan User. Atau lewat curl dari Wazuh manager:

   ```bash
   W=https://localhost:55000
   TOKEN=$(curl -sk -u wazuh-wui:<password-wazuh-wui> -X POST "$W/security/user/authenticate?raw=true")
   H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

   # policy: hanya event:ingest
   curl -sk "${H[@]}" -X POST "$W/security/policies" \
     -d '{"name":"ssl_monitoring_ingest","policy":{"actions":["event:ingest"],"resources":["*:*:*"],"effect":"allow"}}'
   # role
   curl -sk "${H[@]}" -X POST "$W/security/roles" -d '{"name":"ssl_monitoring_ingest"}'
   # user (password: 8–64 karakter, huruf besar, huruf kecil, angka, simbol)
   curl -sk "${H[@]}" -X POST "$W/security/users" -d '{"username":"ssl-monitoring","password":"<Password_Kuat1!>"}'

   # sambungkan: ganti <POLICY_ID>, <ROLE_ID>, <USER_ID> dengan id dari balasan perintah di atas
   curl -sk "${H[@]}" -X POST "$W/security/roles/<ROLE_ID>/policies?policy_ids=<POLICY_ID>"
   curl -sk "${H[@]}" -X POST "$W/security/users/<USER_ID>/roles?role_ids=<ROLE_ID>"
   ```

2. **Pasang rules**: di Settings klik **Download rules Wazuh** (atau ambil `wazuh/ssl_monitoring_rules.xml` dari proyek ini), simpan di manager sebagai `/var/ossec/etc/rules/ssl_monitoring_rules.xml`, lalu `systemctl restart wazuh-manager`. Rule ID 100700–100749, contoh:

   | Rule | Level | Kejadian |
   |---|---|---|
   | 100712 | 5 | login gagal |
   | 100713 | 10 | 5 login gagal dalam 5 menit dari IP yang sama (brute force, MITRE T1110) |
   | 100714 | 10 | akun terkunci |
   | 100715 | 8 | perubahan akun user |
   | 100717 | 7 | pengaturan diubah |
   | 100718 | 10 | request SOAR dengan API key salah |
   | 100732 | 8 | sertifikat Check Failed |
   | 100738 | 8 | sertifikat Reminder (≤ 14 hari) |
   | 100733 | 10 | sertifikat Urgent (≤ 7 hari) |
   | 100734 | 12 | sertifikat Expired |

   Cek rules dengan `/var/ossec/bin/wazuh-logtest` lalu tempel satu baris dari `data/logs/ssl-monitoring-wazuh.json`.
3. Pastikan laptop ini bisa menjangkau port **55000** Wazuh manager.

### Langkah di aplikasi

*Settings → Integrasi → klik ikon Wazuh*: pilih cara kirim, isi URL (`https://wazuh-manager:55000`), username & password user API tadi (atau API key), klik **Tes koneksi**, centang **Kirim log ke Wazuh**, lalu **Simpan**. Hasilnya terlihat di Wazuh: *Threat Hunting*, filter `rule.groups: ssl_monitoring`.

Untuk mode **File + Wazuh agent**, tambahkan ke `ossec.conf` agent di laptop ini (Windows: `C:\Program Files (x86)\ossec-agent\ossec.conf`), lalu restart agent:

```xml
<localfile>
  <log_format>json</log_format>
  <location>C:\Users\<nama>\Downloads\ssl-monitoring-v4\ssl-monitoring\data\logs\ssl-monitoring-wazuh.json</location>
</localfile>
```

### Catatan

- Wazuh API bawaan memakai sertifikat self-signed, jadi *Verifikasi sertifikat HTTPS* default mati. Nyalakan kalau sertifikat Wazuh sudah dari CA kantor.
- Temuan SSL dikirim saat status berubah, lalu diulang setiap 24 jam (bisa diatur) selama masih bermasalah.
- **IP pengirim (`src_ip`)**: dengan `npm start` / `npm run start:lan`, IP diambil dari koneksi TCP sehingga tidak bisa dipalsukan lewat header. Dengan `npm run dev`, IP hanya dari header `X-Forwarded-For` (bisa dipalsukan), jadi pakai `npm start` untuk production.
- Password / API key Wazuh disimpan di database (tidak ikut ke GitHub) dan tidak pernah ditampilkan atau dicatat di audit log.

## 11. Integrasi SOAR (dua arah)

Klik ikon **SOAR** di **Settings → Integrasi**. Halamannya punya dua bagian:

**Aplikasi → SOAR** — aplikasi mengirim alert SSL, hasil scan scheduler, dan info sistem ke webhook SOAR (lihat bagian *Notifikasi* di atas).

**SOAR → Aplikasi** — SOAR mengirim data dan perintah ke aplikasi:

1. Klik **Buat API key**, salin key-nya (hanya tampil sekali), simpan di SOAR.
2. Pilih file Source of Truth tujuan (default `SOAR`, dibuat otomatis), group dashboard, dan cara cek (tanpa / dengan proxy).
3. Centang **Izinkan SOAR mengirim ke aplikasi**, lalu **Simpan**.

| Endpoint | Fungsi |
|---|---|
| `POST /api/soar/domains` | Kirim domain. Langsung dicek, dan statusnya dibalas di response. Format: `{"domain":…}`, array, `{"domains":[…]}`, NDJSON, atau format Splunk HEC `{"event":{…}}`. Field: `domain` / `fqdn` / `host` / `url`, `port`, `environment`, `application`, `owner`, `notes`, `action` (`add` / `remove`). `?scan=0` = jangan langsung dicek. |
| `GET /api/soar/domains` | Tanya status sertifikat. Filter `?domain=a.com,b.com`, `&status=URGENT,CHECK_FAILED,EXPIRED`, `&group=Public`, `&file=SOAR`. |
| `POST /api/soar/command` | Jalankan job: `{"action":"scan"\|"retry_failed"\|"conn_test"\|"report","group":"Public","wait":true}`. Tanpa `wait` langsung dibalas 202 dan job jalan di belakang. |
| `POST /services/collector/event` | Kompatibel Splunk HEC (`Authorization: Splunk <key>`) untuk flow SOAR lama. |

Header: `Authorization: Bearer <API key>` (atau `X-Api-Key: <API key>`). Contoh:

```bash
curl -X POST "http://ssl-monitor.kantor:3000/api/soar/domains" \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"domains":[{"domain":"app.kantor.co.id","environment":"Production","owner":"Tim Web"},"api.kantor.co.id"]}'
```

Balasan: `{ok, file, received, added, updated, removed, invalid:[…], results:[{domain, port, status, expired, days_remaining, expires_at, error, group, file, result}]}`.

Catatan:
- **SOAR harus bisa menjangkau aplikasi.** `npm start` (dan shortcut Desktop) hanya mendengarkan `127.0.0.1`. Supaya bisa diakses dari server SOAR, jalankan `npm run start:lan`, buka port 3000 di Windows Firewall, dan pakai IP / nama komputer ini di SOAR.
- SOAR hanya bisa menghapus domain kalau **SOAR boleh menghapus domain** dicentang, dan hanya di file SOAR. Perintah Scan / Retry / Tes koneksi bisa dimatikan.
- Semua request (termasuk API key salah) tercatat di Audit Log kategori **SOAR**, tampil di halaman SOAR (*Request terakhir dari SOAR*) dan Health Check, dan ikut dikirim ke Wazuh kalau aktif.
- API key disimpan sebagai hash. Kalau bocor, klik **Buat key baru** (key lama langsung tidak berlaku).

## 12. Arti status

| Status | Arti (ambang default, bisa diubah di **Settings → Aturan status & scan**) |
|---|---|
| **Check Failed** | Sertifikat / tanggal expired **tidak bisa dibaca**: tidak bisa terhubung, DNS tidak ada, timeout, koneksi ditolak |
| **Urgent Renewal** | ≤ 7 hari lagi, **atau sudah expired** |
| **Reminder Exp.** | 8–14 hari lagi |
| **Need Update** | 15–30 hari lagi |
| **Warning Update** | 31–60 hari lagi |
| **Informational** | 61–90 hari lagi |
| **OK** | lebih dari 90 hari lagi |
| **Belum dicek** | domain baru yang belum pernah di-scan |

Masalah kepercayaan sertifikat (**nama tidak cocok**, self-signed, root CA tidak dipercaya) tetap ditampilkan sebagai catatan kuning di bawah nama domain, tapi statusnya mengikuti sisa hari karena tanggal expired-nya terbaca. Perubahan ambang langsung berlaku tanpa scan ulang. Kolom *Expires In* menampilkan *"N hari lagi"* atau *"expired N hari lalu"*.

## 13. Fitur lain

- **Sync Now** (kanan atas): scan SSL semua domain.
- **Scan otomatis**: tiap N jam selama aplikasi berjalan. Atur di Settings (0 = mati).
- **Periode** (kanan atas): rentang waktu untuk grafik tren dan daftar aktivitas.
- **Filter & urut per kolom** di tabel SSL Inventory (seperti filter di Excel): klik judul kolom untuk mengurutkan, klik ikon corong untuk memilih nilai yang ditampilkan (File, Environment, Application, Owner, Port, Status SSL, Issuer), mencari teks (Domain), memilih masa berlaku (Expires In / Tanggal Expired: sudah expired, habis ≤ 7/30/60/90 hari, atau antara dua tanggal), atau Last Checked (belum pernah / lebih dari N hari lalu). Filter aktif tampil sebagai chip di atas tabel. Daftar nilai tiap kolom mengikuti filter kolom lain.
- **Dropdown group** di SSL Inventory untuk menampilkan domain dari satu group saja (filter File ada di header kolom File). Tombol *Export* ikut memakai semua filter.
- **Detail domain**: klik nama domain untuk melihat issuer, tanggal berlaku, SAN, riwayat cek, dan tombol *Cek ulang sekarang*.

Perintah terminal:

```bash
npm run scan                # scan semua domain
npm run reset               # kosongkan data domain (user, audit & pengaturan tetap)
npm run build && npm start  # mode production (lebih ringan dari npm run dev, Restart service tetap bisa)
```

## 14. Simpan ke GitHub

Buat repository **Private** di GitHub, lalu:

```bash
git remote add origin https://github.com/USERNAME/ssl-monitoring.git
git push -u origin main
```

`.gitignore` sudah mencegah data lokal ikut ter-push: database lokal (`data/pg/`, juga `data/*.db` versi lama), pengaturan lama (`data/settings.json`), `.env.local` (berisi `DATABASE_URL`), dan `node_modules`. Cek dengan `git status` sebelum push.

## 15. Deploy ke Vercel + Supabase

### Gambaran

- **Supabase** menyimpan semua data: domain, file Source of Truth, group, user, audit log, pengaturan (termasuk token integrasi), antrean job.
- **Vercel** menjalankan dashboard dari repo GitHub (setiap `git push` otomatis ter-deploy).
- **Scan** dijalankan salah satu (pilih di *Settings → Aturan status & scan → Scan dijalankan oleh*):
  - **Vercel (cloud)** — scan otomatis lewat Vercel Cron. Cukup kalau semua domain bisa dibuka dari internet.
  - **Scanner kantor** — laptop/server kantor menjalankan aplikasi ini (`npm start`) dengan `DATABASE_URL` Supabase yang sama. Dipakai kalau ada domain internal, perlu proxy kantor, atau perlu ping/telnet dari jaringan kantor. Tombol **Scan / Retry / Tes koneksi / Cek ulang** di Vercel dimasukkan ke **antrean**, scanner kantor mengambilnya tiap ±10 detik, lalu hasilnya muncul di dashboard Vercel. Status scanner & antrean terlihat di menu **Jobs**.

### Langkah 1 — Supabase

1. Buat project di **supabase.com** (region **Singapore** paling dekat).
2. **Project Settings → Database → Connection string → URI**. Salin yang **Transaction pooler** (port **6543**), ganti `[YOUR-PASSWORD]` dengan password database.
   Contoh: `postgresql://postgres.abcd1234:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
3. Tidak perlu membuat tabel manual: tabel dibuat otomatis saat aplikasi pertama kali tersambung. Semua tabel diberi **Row Level Security** (tertutup untuk REST API Supabase / anon key); aplikasi tetap bisa membaca karena tersambung langsung lewat `DATABASE_URL`.

### Langkah 2 — Vercel

1. **vercel.com → Add New → Project → Import** repo GitHub `ssl-monitoring`. Framework otomatis *Next.js*. Klik **Deploy** (boleh gagal dulu, lanjut langkah berikut).
2. **Settings → Environment Variables**, isi (centang Production, Preview, Development):

   | Nama | Isi |
   |---|---|
   | `DATABASE_URL` | URI Supabase dari langkah 1 (atau sambungkan lewat **Storage → Supabase**, yang mengisi `POSTGRES_URL` otomatis) |
   | `CRON_SECRET` | teks acak panjang, mis. hasil `openssl rand -hex 32` |
   | `SCAN_RUNNER` | (opsional) `local` kalau dari awal mau pakai scanner kantor |

3. **Deployments → … → Redeploy**. Buka alamat Vercel-nya → buat akun Admin pertama (atau login dengan akun lama kalau data lama sudah dipindahkan, lihat langkah 4).
4. Kalau memakai Entra ID: ganti **Redirect URI** di App registration menjadi `https://ALAMAT-VERCEL/api/auth/microsoft/callback`.

**Vercel Cron.** `vercel.json` menjalankan `/api/cron` **sekali sehari pukul 08.00 WIB** (batas paket Hobby). `/api/cron` menjalankan scan kalau sudah waktunya (Settings → *Scan otomatis tiap N jam*), mengecek kondisi sistem, dan mengirim antrean Wazuh. Supaya lebih sering:
- paket **Pro**: ubah `schedule` di `vercel.json` menjadi `0 * * * *` (tiap jam), atau
- pakai layanan cron gratis (mis. **cron-job.org**): panggil `GET https://ALAMAT-VERCEL/api/cron` dengan header `Authorization: Bearer <CRON_SECRET>` tiap 15–60 menit, atau
- pakai **scanner kantor** (jadwalnya dijalankan laptop kantor).

**Batas waktu.** Satu request di Vercel maksimal ±60 detik. Kalau domain banyak, scan di Vercel mengerjakan domain yang paling lama tidak dicek lebih dulu dan sisanya dilanjutkan otomatis di panggilan cron berikutnya (tertulis di pesan scan: *"… domain dilanjutkan scan berikutnya"*). Scanner kantor tidak punya batas ini.

**Yang tidak tersedia di Vercel:** restart service, Wazuh mode *file + agent*, ping (Vercel tidak mengizinkan ICMP — tes koneksi tetap menjalankan DNS, port, dan HTTPS). Angka CPU/RAM/Disk di Health Check milik server Vercel, bukan alarm.

### Langkah 3 — Scanner kantor (kalau dipilih)

Di laptop/server kantor yang bisa menjangkau domain internal:

1. Pasang aplikasi seperti biasa (`pasang.ps1`).
2. Buat file **`.env.local`** di folder aplikasi berisi:
   ```
   DATABASE_URL=postgresql://postgres.abcd1234:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```
   (Kalau jaringan kantor memblokir port 6543, pakai *Session pooler* port 5432.)
3. Jalankan (`npm start` / shortcut Desktop). Di terminal muncul `[scanner] scanner kantor aktif`. Di Vercel → **Jobs** → *Scanner*, komputer ini tampil **online**.
4. Di Vercel → **Settings → Aturan status & scan → Scan dijalankan oleh → Scanner kantor** → Simpan.

Biarkan scanner kantor menyala. Kalau mati, job di antrean menunggu sampai scanner menyala lagi (dibatalkan otomatis setelah 6 jam). Boleh lebih dari satu scanner; satu job hanya diambil satu scanner, dan scan tidak pernah berjalan dobel.

### Langkah 4 — Memindahkan data lama ke Supabase

Data dari versi lokal (domain, file, group, user, audit log, pengaturan) dipindahkan **otomatis** saat aplikasi start pertama kali dengan `DATABASE_URL` Supabase, **selama database Supabase masih kosong**:

1. Di laptop yang berisi data lama, buat `.env.local` berisi `DATABASE_URL` Supabase (langkah 3).
2. Jalankan aplikasi (atau `npm run import-local`). Terminal menampilkan `[impor] data versi lama dipindahkan: …`.
3. Buka alamat Vercel → login dengan akun yang sama seperti di laptop.

Yang dipindahkan adalah file SQLite versi 2.0 (`data/real.db`, `data/app.db`, `data/settings.json`). Kalau database Supabase sudah berisi data, impor dilewati supaya tidak tercampur.

## 16. Install di laptop kantor

```bash
git clone https://github.com/USERNAME/ssl-monitoring.git
cd ssl-monitoring
npm install
npx next telemetry disable
npm run dev
```

Lalu upload Excel domain kantor di **Source of Truth**.

### Kalau kantor memakai proxy (untuk npm install)

```bash
npm config set proxy http://proxy.kantor:8080
npm config set https-proxy http://proxy.kantor:8080
```

### Kalau domain internal memakai CA internal perusahaan

Tanpa langkah ini, domain internal akan berstatus *Check Failed* (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN`). Minta file root CA (`.pem`/`.crt`) ke tim IT/Security, lalu jalankan:

```powershell
# Windows (PowerShell)
$env:NODE_EXTRA_CA_CERTS="C:\path\ke\root-ca-kantor.pem"; npm run dev
```

```bash
# Linux / Mac
NODE_EXTRA_CA_CERTS=/path/ke/root-ca-kantor.pem npm run dev
```

## 17. Proxy untuk cek SSL

*Settings → Proxy untuk cek SSL*: isi `http://proxy.kantor:8080` (+ username/password bila perlu), klik **Tes proxy**. Domain dicek lewat HTTP CONNECT, sehingga yang terbaca tetap sertifikat asli server. Kapan proxy dipakai diatur per file di **Source of Truth** (lihat *Pilihan proxy per file*).

## 18. Menjadwalkan scan tanpa membuka dashboard

Selama aplikasi (`npm start` / shortcut Desktop) menyala, scan otomatis sudah berjalan sendiri tanpa perlu membuka dashboard. Alternatif tanpa aplikasi menyala:

- **Windows Task Scheduler**: buat task baru → Action: *Start a program*
  - Program: `npm.cmd`
  - Arguments: `run scan`
  - Start in: `C:\path\ke\ssl-monitoring`
- **Linux/Mac (cron)**, tiap 6 jam:
  ```
  0 */6 * * * cd /path/ke/ssl-monitoring && npm run scan >> scan.log 2>&1
  ```

## 19. Struktur proyek

```
app/                     Dashboard (Next.js) + API
  api/dashboard          ringkasan kartu, grafik, aktivitas (+ periode)
  api/dashboard/monitoring  Dashboard Monitoring (kartu & panel)
  api/domains            tabel inventory (+ filter per kolom), detail, cek ulang, domain yang dihapus
  api/auth/microsoft/*   login Microsoft Entra ID (OIDC + PKCE)
  api/entra/*            tes koneksi & status Entra ID
  api/soar/*             SOAR → aplikasi: domains (kirim / tanya status), command, key
  api/wazuh/*            tes koneksi, status & antrean, download rules Wazuh
  services/collector/event   kompatibel Splunk HEC (SOAR → aplikasi)
  api/files              daftar file Source of Truth, buat, ganti nama / group / proxy, hapus
  api/groups             group dashboard: daftar, tambah, ganti nama, hapus
  api/dashboard/group    dashboard satu group
  api/tools/conntest     tes koneksi (DNS, ping, telnet, curl)
  api/notify/test        kirim pesan tes ke satu saluran notifikasi
  api/excel              tambah / ubah / hapus domain, download Excel terbaru per file
  api/upload             upload Excel ke file baru / file yang sudah ada (ganti isi / gabungkan)
  api/settings           pengaturan, kosongkan data
  api/jobs               daftar job, jalankan job, riwayat
  api/sync               tombol Sync Now (scan SSL)
  api/service            status service, restart ringan / penuh
  api/cron               dipanggil Vercel Cron (scan otomatis, cek sistem, antrean Wazuh)
  api/boot               menyalakan scheduler saat npm start (internal)
  api/auth/*             login, logout, setup admin pertama, ganti password
  api/users              kelola user (admin)
  api/audit              audit log + export
  api/health             health check
  api/export, api/template, api/activities
components/              Komponen tampilan
wazuh/                   rules Wazuh (ssl_monitoring_rules.xml)
lib/
  pg.js, schema.js       koneksi database (Supabase via DATABASE_URL, atau PGlite lokal di data/pg) & skema tabel (dibuat otomatis)
  settings.js            pengaturan (tabel app_settings)
  db.js                  data domain, file Source of Truth, group, riwayat
  scanner.js, locks.js   scanner kantor (antrean job & detak) dan kunci scan bersama
  legacy.js              pindahkan data versi 2.0 (SQLite) ke database baru
  ssl-check.js           cek sertifikat via koneksi TLS (langsung, lewat proxy, atau langsung → otomatis proxy kalau gagal)
  excel.js               baca file Excel
  status.js              aturan status
  jobs.js                import Excel, tambah/ubah/hapus, scan
  monitoring.js          perhitungan Dashboard Monitoring (panel per group) & dashboard group
  conntest.js            tes koneksi: DNS → ping → telnet (port) → curl (HTTPS), langsung & lewat proxy
  entra.js               Microsoft Entra ID: login, peran dari grup, sync user (Microsoft Graph)
  soar-in.js             SOAR → aplikasi: API key, terima domain, status, perintah
  wazuh.js               kirim log aplikasi, keamanan & temuan SSL ke Wazuh (antrean)
  notify.js              notifikasi Teams / Telegram / WhatsApp / Email / SOAR: alert, hasil scan, info sistem
  filter.js              filter & urut SSL Inventory, daftar nilai per kolom
  auth.js                user, password (scrypt), sesi login, peran & izin
  audit.js               audit log (aplikasi & sistem)
  health.js              CPU, RAM, Disk, status service
  runner.js              daftar job + pencatatan riwayat
  service.js             status & restart service
  scheduler.js           scan otomatis, scanner kantor (ambil antrean), cek kondisi sistem; cronTick untuk Vercel Cron
scripts/                 perintah terminal (scan, reset, reset-admin, import-local, sample:excel) + serve.js (supervisor npm start) + server.js (server production)
pasang.ps1, jalankan.bat pemasangan & menjalankan di Windows
vercel.json              Vercel Cron & region
data/
  sample/                Excel contoh
```

> Versi 2.1 memindahkan penyimpanan dari SQLite (`data/*.db`, `data/settings.json`) ke Postgres (Supabase atau database lokal `data/pg`), supaya bisa jalan di Vercel. Data versi 2.0 dipindahkan otomatis.

## 20. Rencana berikutnya (opsional)

- Notifikasi Slack.
- Scan terjadwal lewat GitHub Actions (alternatif Vercel Cron).
