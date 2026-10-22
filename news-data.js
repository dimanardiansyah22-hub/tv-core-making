/*
 * Data News / Running Text — TV Core Making
 * ------------------------------------------------
 * Data cadangan awal. Input berita dilakukan lewat form di halaman News.
 * Data form disimpan ke server (app=news); bila server belum tersedia,
 * data disimpan di perangkat dan tetap tampil di halaman News + running text.
 *
 * Format cadangan:
 *
 *   { date: '2026-10-22', text: 'Isi berita...' }
 *
 * - Tambahkan "active: false" jika berita tetap ingin ditampilkan di halaman
 *   News, tetapi tidak diikutkan pada running text.
 * - Urutan tampil mengikuti tanggal (terbaru di atas).
 */
window.TVC_NEWS = [];
