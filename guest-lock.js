/*
 * guest-lock.js — Mode Tamu (read-only)
 * -------------------------------------------------------------
 * Dipanggil tiap halaman internal (mapping, OEE, laporan, planning)
 * dengan parameter URL ?role=guest. Saat aktif:
 *  - Banner "MODE TAMU" di atas halaman.
 *  - Bidang isian teks, textarea, contenteditable, dan canvas
 *    dinonaktifkan (tidak bisa input / gambar).
 *  - Tombol yang jelas-jelas aksi tulis (Simpan/Tambah/Hapus/
 *    Edit/Ubah/Submit/Upload/Kirim, dsb.) dinonaktifkan.
 *  - Kontrol navigasi/filter (select, search, checkbox) tetap jalan
 *    agar tamu tetap bisa melihat & menyaring data.
 * Jika role bukan 'guest', skrip ini tidak melakukan apa-apa.
 */
(function () {
  'use strict';
  var role = '';
  try { role = new URLSearchParams(window.location.search).get('role') || ''; } catch (e) {}
  if (role !== 'guest') return;

  var ACTION_WORDS = ['simpan', 'tambah', 'hapus', 'ubah', 'edit', 'delete', 'add', 'save', 'submit', 'update', 'upload', 'kirim', 'reset', 'konfirmasi', 'barcode'];

  function isWriteEl(el) {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    var tag = (el.tagName || '').toLowerCase();
    if (el.getAttribute('contenteditable') === 'true') return true;
    if (tag === 'textarea') return true;
    if (tag === 'canvas') return true;
    if (tag === 'input') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'hidden' || t === 'search' || t === 'checkbox' || t === 'radio' || t === 'range' || t === 'date' || t === 'month') return false;
      return true;
    }
    if (tag === 'button') {
      if (el.type === 'submit') return true;
      var txt = (el.textContent || '').toLowerCase();
      var cls = String(el.className || '');
      var ind = String(el.getAttribute('data-action') || '').toLowerCase();
      for (var i = 0; i < ACTION_WORDS.length; i++) {
        if (txt.indexOf(ACTION_WORDS[i]) !== -1) return true;
        if (cls.indexOf(ACTION_WORDS[i]) !== -1) return true;
        if (ind.indexOf(ACTION_WORDS[i]) !== -1) return true;
      }
    }
    return false;
  }

  function lock() {
    document.querySelectorAll('input,select,textarea,button,[contenteditable],canvas,[role="button"],[onclick]').forEach(function (el) {
      if (isWriteEl(el)) {
        el.disabled = true;
        el.setAttribute('aria-disabled', 'true');
        el.style.opacity = '0.55';
        el.style.pointerEvents = 'none';
      }
    });
  }

  function addBanner() {
    var b = document.createElement('div');
    b.textContent = 'MODE TAMU — hanya melihat, tidak dapat mengubah data';
    b.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:99999;background:#334155;color:#fff;text-align:center;font:700 12px/1 sans-serif;padding:7px 10px;letter-spacing:.05em;';
    document.body.insertBefore(b, document.body.firstChild);
  }

  function boot() {
    addBanner();
    lock();
    var mo = new MutationObserver(function () { lock(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();