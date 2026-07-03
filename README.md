# SiberCraft

**Buat tampilan web dengan AI, langsung dari percakapan — di atas canvas tanpa batas.**

SiberCraft mengubah ide, gambar referensi, atau deskripsi menjadi mockup, dashboard, chart, diagram, landing page, dan prototype interaktif. Cukup jelaskan tampilan yang diinginkan, AI akan membuat frame preview di canvas luas yang bisa di-pan, di-zoom, dan di-drag — mirip Figma atau Canva.

Anda tidak harus memahami pemrograman untuk mulai menggunakan SiberCraft, dan **tidak perlu mendaftar** — bisa langsung dipakai sebagai tamu.

## Apa yang dapat dibuat?

SiberCraft dapat membantu membuat berbagai tampilan, misalnya:

- Landing page produk atau bisnis
- Dashboard penjualan dan laporan
- Chart dan visualisasi data
- Diagram alur atau proses kerja
- Halaman profil dan portfolio
- Form, tabel, kartu, sidebar, dan navigasi
- Tampilan desktop, tablet, dan mobile
- Prototype dengan tombol dan interaksi sederhana
- Tampilan baru berdasarkan screenshot atau gambar referensi

## Konsep utama: Canvas Workspace

Saat membuka sebuah project, Anda langsung masuk ke **canvas workspace** — sebuah area kerja tanpa batas (infinite canvas) yang diilhami editor seperti Figma, Canva, dan draw.io.

### Panel percakapan (collapsible)

- Panel chat berada di **sebelah kiri** dan **buka-tutup**.
- Saat ditutup, canvas menjadi **seluas layar penuh** sehingga Anda bebas mengamati semua frame.
- Seluruh percakapan, riwayat, dan status proses AI tetap dapat diakses dari panel ini.

### Frame preview

- Setiap permintaan dapat menghasilkan satu atau lebih **frame** di canvas.
- Setiap frame adalah **preview live** dari satu file HTML di workspace project — interaktif (bisa diklik, di-scroll, diisi form).
- **AI yang mengelola frame**: AI memanggil tool `create_frame` untuk mendaftarkan frame baru, lalu menulis isi file-nya. Anda tidak perlu membuat frame secara manual.
- Nama frame diambil dari nama file (mis. `dashboard.html` → "dashboard").
- Posisi frame otomatis ditata (auto-layout) saat dibuat, lalu Anda bebas men-drag-nya.

### Navigasi canvas

- **Drag area kosong** → geser (pan) seluruh canvas.
- **Ctrl/Cmd + scroll** → zoom around cursor.
- **Drag tepi frame** (border strip) → pindahkan frame.
- **Klik tengah frame** → berinteraksi dengan konten preview (tombol, link, form).
- Tombol zoom (− / % / + / ⊡) tersedia di header dan pojok canvas.
- **Auto-fit**: semua frame otomatis di-zoom agar terlihat dan ter-center saat masuk atau setelah turn AI selesai.

### Live preview saat AI bekerja

Saat AI sedang membuat atau mengubah file, canvas menampilkan **preview yang ter-update secara bertahap** (streaming):

- Frame yang sedang dibangun mendapat outline dan label "drafting".
- Canvas **otomatis zoom-in** ke frame yang sedang diedit, lalu **kembali ke fit-all** setelah turn selesai.
- Bila AI mengedit beberapa frame dalam satu turn, fokus **bergantian** mengikuti file yang sedang dikerjakan.
- Indikator status menunjukkan tool mana yang sedang berjalan beserta posisinya (mis. "Writing file (2/4)").

## Akun, mode anonim, dan proyek publik

SiberCraft dapat dipakai **tanpa harus mendaftar**. Anda dapat langsung mulai membuat project sebagai tamu (anonim), atau membuat akun untuk menyimpan project secara permanen.

### Mode anonim (tanpa akun)

Saat pertama kali membuka aplikasi tanpa login, Anda otomatis berada dalam **mode anonim**. Anda dapat langsung membuat project dan mengobrol dengan AI.

- Project anonim disimpan di browser ini dan terikat pada identitas anonim Anda.
- Terdapat batas jumlah project untuk mode anonim (default 3 project, dapat diatur oleh pengelola).
- Jika batas tercapai, Anda akan diminta login untuk membuat lebih banyak project.

### Mendaftar akun

Untuk membuat akun, tekan tombol **Register** pada bagian atas halaman, lalu:

1. Masukkan alamat email Anda.
2. SiberCraft mengirim tautan verifikasi ke email tersebut.
3. Buka tautan di email, masukkan dan konfirmasi kata sandi, lalu akun aktif.
4. Setelah aktif, masuk dengan email dan kata sandi Anda.

Tautan verifikasi berlaku 24 jam dan hanya dapat digunakan satu kali. Jika tidak menemukan email, periksa folder spam.

Saat Anda login, **project anonim yang telah dibuat akan otomatis dipindahkan ke akun Anda**, sehingga tidak ada pekerjaan yang hilang.

### Peran dan tier

Setiap akun memiliki **peran (role)** dan **tier**:

- **Peran:** `user` (default) atau `admin`. Akun admin dapat mengelola pengguna lewat panel admin. Alamat email yang terdaftar sebagai admin oleh pengelola aplikasi akan otomatis mendapat peran admin saat mendaftar.
- **Tier:** `free` (default), `tier1`, `tier2`, atau `tier3`. Tier disimpan dan ditampilkan, namun saat ini belum ada pembatasan fitur berdasarkan tier.

### Galeri proyek publik

Project yang dibuat dalam mode anonim bersifat **publik** dan dapat dilihat oleh semua orang di halaman utama, layaknya galeri komunitas.

- Siapa pun dapat **melihat** dan membuka preview project publik di canvas (mode read-only).
- Namun, hanya **pemilik** yang dapat mengedit, mengobrol, atau menghapus project miliknya sendiri.
- Saat Anda membuka project publik milik orang lain, tombol chat dan hapus dinonaktifkan.

## Mulai menggunakan SiberCraft

### 1. Buat project baru

Dari halaman utama, pilih **Sesi baru**, masukkan nama project, pilih template (blank canvas atau dashboard), lalu tekan **Buat sesi**. Anda langsung masuk ke canvas workspace.

### 2. Jelaskan tampilan yang diinginkan

Tulis permintaan pada kolom chat. Semakin jelas keterangannya, semakin sesuai hasil yang dibuat.

Contoh:

```text
Buat landing page untuk aplikasi keuangan pribadi.
Gunakan dark mode, warna hijau lembut, hero yang sederhana,
daftar fitur, testimoni, dan tombol mulai gratis.
```

Tekan **Enter** untuk mengirim. Gunakan **Shift + Enter** jika ingin membuat baris baru.

### 3. Amati proses di canvas

Saat AI bekerja:

- Frame baru muncul di canvas seketika (AI memanggil `create_frame`), dengan label file-nya.
- Canvas otomatis zoom-in ke frame yang sedang dibangun.
- Preview terisi bertahap (streaming) sampai selesai, lalu canvas kembali ke tampilan semua frame.
- Panel chat menampilkan setiap langkah AI (tool calls) beserta status proses.

### 4. Tambahkan gambar referensi (opsional)

Tekan ikon gambar di area chat untuk menambahkan screenshot, wireframe, foto, atau referensi visual. SiberCraft otomatis menggunakan AI multimodal pada permintaan yang berisi gambar.

Format yang didukung: PNG, JPEG, WebP, dan GIF (maksimal 4 gambar, 1 MB per gambar, 4 MB total per permintaan).

### 5. Lanjutkan dengan revisi

Anda dapat memberikan revisi lanjutan seperti:

```text
Ubah warna utama menjadi biru gelap dan kecilkan tinggi header.
```

```text
Buat versi mobile untuk halaman login di frame baru.
```

AI akan menggunakan konteks percakapan dan kondisi project pada sesi yang sama.

## Fitur utama

### Canvas tanpa batas

Canvas dapat di-pan dan di-zoom tanpa batas, menampung banyak frame sekaligus. Layout otomatis menata frame baru, dan Anda bebas men-drag ulang posisinya.

### AI yang mengelola frame

AI memutuskan kapan membuat frame baru lewat tool `create_frame`, memilih ukuran device (desktop/tablet/mobile) sesuai konteks permintaan, dan menulis isi file-nya. Sebagai fallback, bila AI lupa mendaftarkan frame, sistem otomatis membuat frame saat file HTML pertama kali ditulis.

### Streaming live preview

Saat AI membuat atau mengubah file, preview di frame bersangkutan ter-update secara bertahap (bukan hanya hasil akhir). Anda melihat proses pembangunan secara real-time.

### Auto-zoom mengikuti frame aktif

Canvas otomatis zoom-in ke frame yang sedang diedit agar terlihat jelas, lalu kembali ke tampilan menyeluruh (fit-all) setelah turn selesai. Bila AI mengedit beberapa frame bergantian dalam satu turn, fokus mengikutinya.

### Multi-frame dalam satu sesi

Satu sesi percakapan dapat memiliki banyak frame, masing-masing menampilkan file HTML berbeda dari workspace yang sama. Ini cocok untuk membuat beberapa halaman sekaligus (mis. dashboard + landing + login).

### Preview interaktif

Frame preview adalah iframe sandbox yang interaktif — Anda dapat mengklik tombol, mengisi form, dan men-scroll konten di dalamnya, sama seperti membuka halaman web sungguhan.

### Diagram terstruktur

Untuk permintaan flowchart, diagram alur, sequence diagram, dan bentuk sejenis, AI akan menggunakan Mermaid.js secara default.

### Undo

Gunakan tombol **Undo** di header canvas untuk membatalkan perubahan terakhir. Undo mencakup seluruh workspace (semua file), sehingga konsisten untuk project multi-frame.

### Export per-frame

Setiap frame memiliki tombol export di HUD-nya (muncul saat hover/select):

- **Export HTML** — unduh file HTML tunggal (semua aset di-inline).
- **Export image** — screenshot penuh frame sebagai PNG dengan lebar sesuai device.

### Migrasi project lama

Project yang dibuat sebelum adanya canvas workspace otomatis dimigrasi saat dibuka: sistem membuat frame untuk file `index.html` yang sudah ada, sehingga konten lama tetap terlihat. Untuk project publik milik orang lain, migrasi dilakukan secara ephemeral di sisi client.

## Tips menulis prompt

Prompt yang baik biasanya menjelaskan beberapa hal berikut:

- **Tujuan:** halaman atau tampilan apa yang ingin dibuat.
- **Isi:** bagian apa saja yang harus tersedia.
- **Gaya:** warna, suasana, bentuk, atau referensi visual.
- **Data:** contoh angka, label, tabel, atau isi chart.
- **Interaksi:** apa yang terjadi ketika tombol atau menu ditekan.
- **Responsif:** bagaimana tampilan harus bekerja di mobile.

Contoh yang lebih lengkap:

```text
Buat dashboard monitoring gudang dengan sidebar compact.
Tambahkan empat kartu statistik, grafik stok masuk dan keluar,
tabel barang hampir habis, serta aktivitas terbaru.
Gunakan warna netral dengan aksen oranye dan pastikan nyaman di mobile.
```

Jika hasil pertama belum sesuai, berikan koreksi yang spesifik. Contohnya, gunakan "padding kartu terlalu besar, kecilkan menjadi lebih rapat" daripada hanya mengatakan "kurang bagus".

## Pertanyaan umum

### Apakah harus memahami coding?

Tidak. Seluruh proses utama dapat dilakukan melalui percakapan. Menu Files tersedia sebagai fitur tambahan bagi pengguna yang ingin memeriksa atau mengedit resource secara manual.

### Apakah harus mendaftar akun?

Tidak. Anda dapat langsung memakai SiberCraft sebagai tamu (anonim). Namun membuat akun membuat project tersimpan permanen, bisa diakses dari perangkat lain, serta menghapus batas jumlah project anonim.

### Bagaimana cara membuat banyak frame?

Cukup jelaskan kebutuhan Anda. AI akan memanggil `create_frame` untuk setiap halaman/surface yang relevan. Misalnya: "Buat dashboard, landing page, dan halaman login" kemungkinan menghasilkan tiga frame terpisah.

### Mengapa canvas otomatis zoom saat AI bekerja?

Agar Anda dapat melihat detail frame yang sedang dibangun dengan jelas. Setelah turn selesai, canvas kembali ke tampilan menyeluruh agar semua frame terlihat.

### Bisakah saya berinteraksi dengan konten di dalam frame?

Ya. Frame adalah preview live yang interaktif — klik tombol, isi form, dan scroll konten di dalamnya. Untuk men-drag frame itu sendiri, tarik dari tepi (border strip) di sekeliling frame.

### Apakah percakapan lama masih tersimpan?

Ya. Percakapan dan resource disimpan sesuai sesinya sehingga dapat dibuka kembali selama sesi tersebut belum dihapus.

### Apa yang terjadi jika proses dihentikan?

Proses AI dihentikan, dan canvas kembali ke kondisi terakhir yang berhasil disimpan.

## Penyiapan untuk pengelola aplikasi

Bagian ini ditujukan bagi yang menjalankan atau mengonfigurasi SiberCraft di server.

### Persyaratan

- Node.js 22 atau lebih baru (diperlukan untuk dukungan `node:sqlite` bawaan).
- Tidak ada dependency eksternal — SiberCraft hanya memakai modul bawaan Node.js.
- Penyedia SMTP untuk pengiriman email verifikasi (mis. Hostinger, Gmail SMTP, dsb).

### Menjalankan

```bash
npm run dev    # mode pengembangan (auto-reload)
npm start      # mode produksi
npm test       # menjalankan test suite
```

Secara default aplikasi berjalan di `http://localhost:3000`.

### Konfigurasi (file `.env`)

Salin `.env.example` menjadi `.env`, lalu sesuaikan. Bagian yang relevan dengan akun dan autentikasi:

```ini
# Alamat aplikasi (untuk tautan verifikasi email)
APP_URL=http://localhost:3000

# Rahasia penandatanganan cookie sesi — WAJIB diisi dengan string acak yang panjang.
# Jika kosong, secret sementara dibuat otomatis (semua sesi logout saat server restart).
SESSION_SECRET=
SESSION_MAX_AGE_DAYS=7

# Daftar email yang otomatis menjadi admin saat mendaftar (pisahkan dengan koma).
ADMIN_EMAILS=admin@example.com

PASSWORD_MIN_LENGTH=8
VERIFICATION_TOKEN_HOURS=24

# Mode anonim
ANON_PROJECT_LIMIT=3
ANON_MAX_AGE_DAYS=30

# Pengiriman email verifikasi (SMTP)
MAIL_MAILER=smtp
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=587
MAIL_USERNAME=craft@example.com
MAIL_PASSWORD=
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=craft@example.com
MAIL_FROM_NAME="Craft idSiber"
```

Konfigurasi lainnya (model AI, screenshot API, optimasi konteks) dijelaskan di `.env.example`.

### Penyimpanan data

- **Data pengguna dan token verifikasi** disimpan di **SQLite** (`data/app.db`).
- **Project/sesi** (percakapan, resource, preview, checkpoint, dan metadata frame) disimpan sebagai **file** di `data/sessions/`. Setiap sesi memiliki `session.json` yang menyimpan daftar frame beserta posisi dan device-nya.
- Seluruh data tersimpan lokal di server tempat SiberCraft dijalankan.

### Membuat akun admin pertama

Karena pendaftaran memerlukan verifikasi email, cara tercepat membuat akun admin pertama adalah dengan skrip `seed:admin`. Skrip ini membuat/mengubah akun admin langsung di database tanpa perlu email verifikasi:

```bash
# Buat akun admin baru (password diminta interaktif, tersembunyi)
npm run seed:admin -- admin@idsiber.com

# Reset password akun admin yang sudah ada
npm run seed:admin -- admin@idsiber.com --reset

# Untuk automasi / non-interaktif (mis. di CI/CD), password via env:
SEED_PASSWORD=rahasia123 npm run seed:admin -- admin@idsiber.com
```

Skrip ini akan:

- Membuat akun dengan `role: admin`, `status: active`, password di-hash (scrypt).
- Bila akun sudah ada tanpa flag `--reset`, diabaikan (anti overwrite tidak sengaja).
- Memberi saran menambahkan email ke `ADMIN_EMAILS` di `.env` bila belum tercantum.

Pastikan `SESSION_SECRET` sudah diisi di `.env` **sebelum** login, agar sesi tidak hilang saat server di-restart.

### Checklist migrasi ke production

| Item | Development | Production |
|------|-------------|------------|
| `SESSION_SECRET` | auto-generate | **wajib** diisi string acak panjang (kalau tidak, semua user logout tiap restart) |
| `APP_URL` | `http://localhost:3000` | `https://domain-anda.com` (agar link verifikasi email benar) |
| `MAIL_*` | SMTP testing | SMTP production yang aktif |
| `ADMIN_EMAILS` | email dev | email admin production |
| HTTPS | tidak perlu | **wajib** (agar cookie `Secure` aktif + register/login aman) |
| Folder `data/` | lokal | harus **writable** oleh proses Node, dan **di-backup** berkala |

Folder `data/` berisi seluruh data pengguna (SQLite) dan project (filesystem) — tidak ikut ter-deploy dari git (ada di `.gitignore`). Di server baru, folder ini terbentuk otomatis saat pertama kali dijalankan, jadi akun perlu dibuat ulang lewat `seed:admin`.

## Membuka aplikasi

Setelah SiberCraft dijalankan oleh pengelola aplikasi, buka alamat yang diberikan melalui browser. Untuk penggunaan lokal, alamat default biasanya:

```text
http://localhost:3000
```

Jika aplikasi tidak dapat dibuka atau status AI menunjukkan belum siap, hubungi pengelola aplikasi untuk memeriksa konfigurasi layanan.

---

SiberCraft dirancang agar proses membuat interface terasa seperti berdiskusi dengan rekan desain dan pengembangan: jelaskan ide, lihat frame tumbuh secara live di canvas, lalu revisi sampai sesuai.

Dikembangkan oleh **datasiberLab**. Kontak: [candrapwr@datasiber.com](mailto:candrapwr@datasiber.com)
