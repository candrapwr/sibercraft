# SiberCraft

**Buat tampilan web dengan AI, langsung dari percakapan.**

SiberCraft membantu mengubah ide atau gambar referensi menjadi mockup, dashboard, chart, diagram, landing page, dan prototype interaktif. Cukup jelaskan tampilan yang diinginkan, lalu AI akan membuat dan memperbarui hasilnya di area preview.

Anda tidak harus memahami pemrograman untuk mulai menggunakan SiberCraft.

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

## Cara kerja

Tampilan SiberCraft terbagi menjadi dua area utama:

- **Panel percakapan di sebelah kiri** untuk menulis permintaan dan melihat proses AI.
- **Live preview di sebelah kanan** untuk melihat hasil tampilan yang sedang dibuat.

Ketika Anda mengirim permintaan, AI akan membaca kebutuhan, memperbarui resource sesi, dan menampilkan hasilnya pada preview. Untuk proses yang lebih besar, perubahan dapat terlihat secara bertahap melalui **Live Draft Preview** sebelum hasil akhirnya selesai.

## Mulai menggunakan SiberCraft

### 1. Buat sesi baru

Dari halaman utama, pilih **Sesi baru**, kemudian:

1. Masukkan nama project.
2. Pilih blank canvas atau template dashboard.
3. Tekan **Buat sesi**.

Setiap sesi menyimpan percakapan, resource, preview, dan riwayat perubahannya sendiri.

### 2. Jelaskan tampilan yang diinginkan

Tulis permintaan pada kolom chat. Semakin jelas keterangannya, semakin sesuai hasil yang dibuat.

Contoh:

```text
Buat landing page untuk aplikasi keuangan pribadi.
Gunakan dark mode, warna hijau lembut, hero yang sederhana,
daftar fitur, testimoni, dan tombol mulai gratis.
```

Tekan **Enter** untuk mengirim. Gunakan **Shift + Enter** jika ingin membuat baris baru.

### 3. Tambahkan gambar referensi (opsional)

Tekan ikon gambar di area chat untuk menambahkan screenshot, wireframe, foto, atau referensi visual. Gambar yang dipilih akan muncul sebagai thumbnail dan dapat dihapus sebelum permintaan dikirim.

SiberCraft otomatis menggunakan AI yang dapat memahami gambar pada permintaan tersebut. Jika permintaan berikutnya hanya berisi teks, aplikasi kembali menggunakan AI utama secara otomatis. Anda tidak perlu mengganti mode secara manual.

Format yang didukung adalah PNG, JPEG, WebP, dan GIF, dengan batas:

- Maksimal 4 gambar dalam satu permintaan
- Maksimal 500 KB untuk setiap gambar
- Maksimal 2 MB untuk seluruh gambar dalam satu permintaan

Contoh permintaan dengan gambar:

```text
Buat dashboard baru dengan susunan seperti gambar ini.
Gunakan dark mode, pertahankan struktur utamanya,
tetapi gunakan warna dan isi yang sesuai untuk monitoring server.
```

### 4. Amati proses dan preview

Saat AI bekerja, panel chat akan menampilkan status proses. Jika AI perlu membaca atau menulis resource, aktivitas tersebut muncul dalam grup **Tool calls**.

Grup ini sengaja dibuat ringkas dan tertutup secara default. Anda dapat membukanya setelah proses selesai untuk melihat detail aktivitas.

Preview akan berubah otomatis. Saat resource berukuran besar sedang dibuat, draft dapat tampil secara bertahap sehingga proses tidak terlihat berhenti.

### 5. Lanjutkan dengan revisi

Tidak perlu mengulang semua penjelasan dari awal. Anda dapat memberikan revisi lanjutan seperti:

```text
Ubah warna utama menjadi biru gelap dan kecilkan tinggi header.
```

```text
Tambahkan chart pendapatan bulanan di bawah kartu statistik.
```

```text
Buat versi mobile lebih ringkas dan ubah sidebar menjadi menu hamburger.
```

AI akan menggunakan konteks percakapan dan kondisi project pada sesi yang sama.

## Cara menulis prompt yang efektif

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

Jika hasil pertama belum sesuai, berikan koreksi yang spesifik. Contohnya, gunakan “padding kartu terlalu besar, kecilkan menjadi lebih rapat” daripada hanya mengatakan “kurang bagus”.

## Fitur utama

### Sesi terpisah

Setiap project dibuat sebagai sesi sendiri. Percakapan dan resource dari satu sesi tidak bercampur dengan sesi lain. Sesi terakhir dapat dibuka kembali dari halaman utama.

### Live Draft Preview

Ketika AI membuat resource baru, preview dapat menampilkan hasil sementara selama proses berlangsung. Setelah selesai, draft otomatis diganti dengan hasil final yang stabil.

### Memahami gambar referensi

SiberCraft dapat membaca gambar yang dilampirkan pada chat dan menggunakannya sebagai konteks untuk membuat atau memperbaiki tampilan. Mode AI yang sesuai dipilih otomatis untuk setiap permintaan, sehingga penggunaan gambar tidak memengaruhi permintaan teks berikutnya.

Gambar yang dikirim disimpan bersama resource sesi agar tetap tersedia saat project dibuka kembali.

### Diagram yang terstruktur

Untuk permintaan flowchart, diagram alur, diagram proses, dan bentuk sejenis, AI akan menggunakan format diagram terstruktur. Hasilnya lebih mudah dibaca, disusun ulang, dan diperbarui melalui permintaan lanjutan.

### Pilihan ukuran preview

Gunakan tombol pada toolbar preview untuk memeriksa tampilan dalam ukuran:

- Desktop
- Tablet
- Mobile

Preview juga dapat direfresh secara manual atau dibuka pada tab browser baru.

### Files

Menu **Files** menampilkan resource yang digunakan oleh mockup. Pengguna yang memahami kode dapat membuka dan mengedit isinya secara manual.

Jika Anda tidak memahami kode, sebaiknya lakukan perubahan melalui chat agar AI dapat menjaga susunan project tetap konsisten.

### Undo

Gunakan tombol **Undo** untuk membatalkan perubahan terakhir dan mengembalikan project ke kondisi sebelumnya.

Undo tersedia setelah terdapat perubahan yang berhasil disimpan pada sesi.

### Stop

Ketika AI sedang bekerja, tombol kirim berubah menjadi tombol **Stop**. Gunakan tombol ini jika ingin menghentikan proses yang sedang berjalan.

Draft yang belum selesai akan dibersihkan dan preview kembali menggunakan hasil terakhir yang valid.

### Informasi penggunaan AI

Angka pada header menunjukkan penggunaan AI untuk proses terakhir. Nilainya di-reset ketika permintaan baru dimulai, kemudian dihitung kembali sampai pekerjaan tersebut selesai.

Di akhir setiap jawaban terdapat label kecil yang menunjukkan AI yang digunakan pada permintaan tersebut, termasuk apakah permintaan diproses dalam mode utama atau mode gambar. Informasi ini disimpan bersama percakapan dan tetap terlihat ketika sesi dibuka kembali.

### Hapus sesi

Sesi dapat dihapus dari kartu pada halaman utama atau dari tombol hapus di dalam workspace.

SiberCraft akan meminta konfirmasi terlebih dahulu. Menghapus sesi juga menghapus percakapan, resource, preview, dan seluruh riwayat perubahan sesi tersebut.

### Export hasil

Gunakan tombol **Export** pada header workspace untuk mengunduh hasil dalam dua format:

- **Single HTML** menggabungkan halaman, tampilan, interaksi, dan gambar lokal menjadi satu file HTML yang mudah dipindahkan atau dibuka kembali.
- **Full-page image** mengambil screenshot penuh preview saat ini dan menyimpannya sebagai gambar PNG.

Export gambar mengikuti ukuran preview yang sedang dipilih. Pilih mode desktop, tablet, atau mobile terlebih dahulu jika membutuhkan ukuran tertentu. Beberapa resource dari internet tetap memerlukan koneksi ketika Single HTML dibuka.

## Memahami status proses

Beberapa status yang mungkin terlihat:

- **AI working** — AI sedang memahami permintaan atau menyiapkan langkah berikutnya.
- **Reading file** — AI sedang memeriksa resource yang sudah ada.
- **Writing file** — AI sedang membuat atau memperbarui resource.
- **Live draft** — preview sedang menampilkan hasil sementara.
- **Ready** — proses selesai dan aplikasi siap menerima permintaan baru.
- **Error** — proses tidak dapat diselesaikan; pesan penyebab akan ditampilkan pada chat.

## Contoh penggunaan

### Membuat dashboard

```text
Buat dashboard penjualan dark mode dengan sidebar di kiri,
empat kartu KPI, line chart pendapatan, dan tabel transaksi terakhir.
```

### Membuat diagram

```text
Buat diagram alur onboarding pengguna dari registrasi sampai aktivasi.
Gunakan node yang dapat diklik dan panel detail di sebelah kanan.
```

### Memperbaiki tampilan

```text
Rapikan jarak antarbagian, kecilkan ruang di dalam kartu,
dan buat tombol utama tidak terlalu mencolok.
```

### Menambahkan interaksi

```text
Tambahkan filter periode pada chart dan modal detail
ketika salah satu baris tabel ditekan.
```

## Tips penggunaan

- Mulai dari struktur utama, kemudian lakukan revisi secara bertahap.
- Berikan contoh teks dan data agar preview terasa lebih nyata.
- Lampirkan screenshot atau referensi visual jika susunan yang diinginkan sulit dijelaskan dengan teks.
- Sebutkan bagian yang sudah bagus agar AI tidak mengubahnya.
- Periksa mode desktop dan mobile sebelum menyelesaikan sesi.
- Gunakan Undo segera jika perubahan terakhir tidak sesuai.
- Buat sesi berbeda untuk project yang tidak berhubungan.
- Hindari memasukkan password, kode akses rahasia, data pribadi, atau gambar sensitif ke dalam prompt.

## Pertanyaan umum

### Apakah harus memahami coding?

Tidak. Seluruh proses utama dapat dilakukan melalui percakapan. Menu Files tersedia sebagai fitur tambahan bagi pengguna yang ingin memeriksa atau mengedit resource secara manual.

### Mengapa preview berubah beberapa kali saat AI bekerja?

SiberCraft menampilkan draft secara bertahap. Tampilan sementara mungkin belum lengkap, tetapi akan diganti dengan hasil final ketika proses selesai.

### Apakah percakapan lama masih tersimpan?

Ya. Percakapan dan resource disimpan sesuai sesinya sehingga dapat dibuka kembali selama sesi tersebut belum dihapus.

### Kapan mode gambar digunakan?

Mode gambar hanya digunakan ketika permintaan saat ini memiliki gambar terlampir. Permintaan berikutnya yang hanya berisi teks akan kembali menggunakan mode utama secara otomatis.

### Mengapa informasi AI berbeda pada beberapa jawaban?

SiberCraft memilih AI sesuai isi setiap permintaan. Label kecil di akhir jawaban membantu menunjukkan mode yang digunakan tanpa perlu membuka pengaturan teknis.

### Apa yang terjadi jika proses dihentikan?

Proses AI dihentikan, draft sementara dibersihkan, dan preview kembali ke hasil terakhir yang berhasil disimpan.

### Mengapa tombol Undo tidak dapat ditekan?

Undo hanya aktif jika sesi memiliki perubahan sebelumnya yang dapat dikembalikan.

### Apakah sesi yang sudah dihapus dapat dikembalikan?

Tidak. Penghapusan sesi bersifat permanen, sehingga pastikan sesi memang tidak diperlukan sebelum menyetujui konfirmasi.

## Membuka aplikasi

Setelah SiberCraft dijalankan oleh pengelola aplikasi, buka alamat yang diberikan melalui browser. Untuk penggunaan lokal, alamat default biasanya:

```text
http://localhost:3000
```

Jika aplikasi tidak dapat dibuka atau status AI menunjukkan belum siap, hubungi pengelola aplikasi untuk memeriksa konfigurasi layanan.

---

SiberCraft dirancang agar proses membuat interface terasa seperti berdiskusi dengan rekan desain dan pengembangan: jelaskan ide, lampirkan referensi jika diperlukan, lihat hasilnya, lalu revisi sampai sesuai.

Dikembangkan oleh **datasiberLab**. Kontak: [candrapwr@datasiber.com](mailto:candrapwr@datasiber.com)
