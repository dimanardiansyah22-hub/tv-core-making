/*
 * Data News / Running Text — TV Core Making
 * ------------------------------------------------
 * Tambahkan berita di array di bawah. Contoh format:
 *
 *   { tag: 'INFO', date: '2026-10-21', title: 'Judul berita', text: 'Isi berita singkat...' }
 *
 * - field opsional "ticker" untuk teks khusus running text
 * - ticker di index.html memakai "ticker" (fallback ke "text", lalu "title")
 * - halaman news.html menampilkan tag, tanggal, judul, dan isi
 */
window.TVC_NEWS = [];
