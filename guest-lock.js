/*
 * guest-lock.js — Mode Tamu (read-only)
 * -------------------------------------------------------------
 * Dipanggil tiap halaman internal (mapping, OEE, laporan, planning)
 * dengan parameter URL ?role=guest. Saat aktif:
 *  - Bidang isian teks, textarea, contenteditable, dan canvas
 *    dinonaktifkan (tidak bisa input / gambar).
 *  - Tombol yang jelas-jelas aksi tulis (Simpan/Tambah/Hapus/
 *    Edit/Ubah/Submit/Upload/Kirim, dsb.) dinonaktifkan.
 *  - Kontrol navigasi/filter (select, search, checkbox) tetap jalan
 *    agar tamu tetap bisa melihat & menyaring data.
 *  - Indikator mode tamu ditampilkan oleh badge di header index.html
 *    (tidak dipasang callout di badan halaman).
 * Jika role bukan 'guest', skrip ini tidak melakukan apa-apa.
 */
(function () {
  'use strict';
  var role = '';
  try { role = new URLSearchParams(window.location.search).get('role') || ''; } catch (e) {}
  if (role !== 'guest') {
    try {
      var parentSession = window.parent && window.parent.tvcSession && window.parent.tvcSession();
      if (parentSession && parentSession.role === 'guest') role = 'guest';
    } catch (e) {}
  }
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

  /* Mapping Pekerjaan: tamu boleh melihat foto mekanik, tapi TIDAK
     boleh klik kiri (buka dropdown / kelola foto) atau klik kanan
     (hapus foto). */
  var page = '';
  try { page = ((location.pathname.split('/').pop() || '') + '').toLowerCase(); } catch (e) {}
  if (page.indexOf('mapping-core') === 0) {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.plus, .photo, #dropdown') : null;
      if (el) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    document.addEventListener('contextmenu', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('.photo') : null;
      if (el) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  function boot() {
    lock();
    var mo = new MutationObserver(function () { lock(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();