/*
 * _sync-lib.js — Library sinkronisasi terpusat TV Core Making
 * ------------------------------------------------------------
 * Dipasang INLINE di tiap halaman HTML karena file dibuka via
 * file:// di device lain (tidak bisa fetch file eksternal lokal
 * secara berantai).
 *
 * Pasangan backend: apps-script-backend.gs
 *  - GET  : JSONP (?app=...&action=get&callback=...) — aman dari file://
 *  - POST : fetch JSON — untuk menyimpan data (juga data besar)
 *  - Modal Pengaturan bawaannya sendiri, URL disimpan per-device.
 *
 * Pemakaian dari aplikasi:
 *   Sync.hasUrl()            → bool
 *   Sync.settings(label)     → buka modal pengaturan URL
 *   Sync.get(app, params)    → Promise<{ok:true,data:{...}}>
 *   Sync.save(app, {core:'red', action:'save', data:{...}})
 *                            → Promise<{ok:true,updatedAt:...}>
 *   Sync.pollMs              → konstanta interval polling
 */
(function () {
  'use strict';
  var LS_KEY_GAS = 'tvcore-gas-url';
  var LS_KEY_GAS_ALT = 'antar-shift-gas-url';
  var POLL_MS = 10000;
  // Utamakan URL yang diatur dari halaman Laporan Antar Shift agar
  // semua aplikasi selalu memakai deployment /exec yang sama.
  var syncUrl = localStorage.getItem(LS_KEY_GAS_ALT) || localStorage.getItem(LS_KEY_GAS) || '';

  // Jika halaman dibuka dengan ?gas=<url> (dari header utama via iframe),
  // gunakan nilai itu sebagai URL backend agar koneksi tetap terbawa
  // meski localStorage tidak dibagi antara parent & iframe.
  try {
    var qGas = new URLSearchParams(window.location.search).get('gas');
    if (qGas) { syncUrl = qGas; persistUrl(qGas); }
  } catch (e) {}

  function persistUrl(u) {
    localStorage.setItem(LS_KEY_GAS, u);
    try { localStorage.setItem(LS_KEY_GAS_ALT, u); } catch (e) {}
  }

  // Deployment resmi (akun yang benar). Migrasi sekali pakai: device
  // yang menyimpan URL akun salah otomatis dialihkan ke sini.
  var CANON_URL = 'https://script.google.com/macros/s/AKfycbwhz_ltIGdXeJZ0qq44u8vamXR0X008SEQJO52K_qmZBY3JqJfFiMR4ohvHO51VfDgOlw/exec';
  var LS_MIGRATE = 'gas-url-migrated-v3';
  try {
    if (!localStorage.getItem(LS_MIGRATE)) {
      syncUrl = CANON_URL;
      persistUrl(CANON_URL);
      localStorage.setItem(LS_MIGRATE, '1');
    }
  } catch (e) {}

  function jsonpGet(app, params) {
    return new Promise(function (resolve, reject) {
      if (!syncUrl) { reject(new Error('URL Apps Script belum diatur. Buka Pengaturan.')); return; }
      var cn = 'tvcb_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
      var s = document.createElement('script');
      var done = false;
      var tmo = setTimeout(fail, 20000);
      function fail() {
        if (done) return; done = true;
        clearTimeout(tmo); delete window[cn];
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error('Server tidak merespons (cek URL di Pengaturan).'));
      }
      window[cn] = function (d) {
        if (done) return; done = true;
        clearTimeout(tmo); delete window[cn];
        if (s.parentNode) s.parentNode.removeChild(s);
        resolve(d);
      };
      var u = syncUrl + '?app=' + encodeURIComponent(app) + '&callback=' + cn;
      for (var k in (params || {})) u += '&' + k + '=' + encodeURIComponent(params[k]);
      s.src = u;
      s.onerror = fail;
      document.body.appendChild(s);
    });
  }

  /* Cadangan: GET biasa via fetch — dipakai bila JSONP diblokir jaringan/ekstensi */
  function fetchGet(app, params) {
    if (!syncUrl) return Promise.reject(new Error('URL Apps Script belum diatur. Buka Pengaturan.'));
    var qs = '?app=' + encodeURIComponent(app);
    for (var k in (params || {})) qs += '&' + k + '=' + encodeURIComponent(params[k]);
    return fetch(syncUrl + qs, { redirect: 'follow' }).then(function (res) {
      if (res.status !== 200) throw new Error('HTTP ' + res.status + ' dari server.');
      return res.json();
    });
  }

  /* Coba JSONP dulu, lalu fetch — mana yang berhasil */
  function getAny(app, params) {
    return jsonpGet(app, params).catch(function () { return fetchGet(app, params); });
  }

  function postJson(payload) {
    if (!syncUrl) return Promise.reject(new Error('URL Apps Script belum diatur. Buka Pengaturan.'));
    return fetch(syncUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    }).then(function (res) {
      if (res.status !== 200) throw new Error('HTTP ' + res.status + ' dari server.');
      return res.json();
    });
  }

  var modalEl = null;
  function buildModal(appLabel) {
    modalEl = document.createElement('div');
    modalEl.id = 'tvcSyncSettings';
    modalEl.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;font-family:sans-serif;';
    modalEl.innerHTML =
      '<div style="background:#fff;border-radius:14px;width:min(92vw,420px);padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)">' +
      '<h3 style="margin:0 0 4px;font-size:17px;font-weight:800;color:#111827">Pengaturan Sinkronisasi — ' + appLabel + '</h3>' +
      '<p style="margin:0 0 14px;font-size:13px;color:#6b7280">URL Google Apps Script (deployment Web App, diakhiri /exec) untuk berbagi data antar device.</p>' +
      '<input id="tvcSyncUrl" type="text" placeholder="https://script.google.com/macros/s/.../exec" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:monospace;color:#111"/>' +
      '<div id="tvcSyncStatus" style="min-height:18px;margin-top:10px;font-size:12px;color:#16a34a"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">' +
      '<button id="tvcSyncCancel" style="padding:9px 16px;border:1px solid #d1d5db;background:#fff;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;color:#374151">Batal</button>' +
      '<button id="tvcSyncSave" style="padding:9px 16px;border:none;background:#2563eb;color:#fff;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">Simpan &amp; Tes</button>' +
      '</div></div>';
    modalEl.querySelector('#tvcSyncCancel').addEventListener('click', function () { modalEl.style.display = 'none'; });
    modalEl.addEventListener('click', function (e) { if (e.target === modalEl) modalEl.style.display = 'none'; });
    modalEl.querySelector('#tvcSyncSave').addEventListener('click', function () {
      var url = modalEl.querySelector('#tvcSyncUrl').value.trim();
      var st = modalEl.querySelector('#tvcSyncStatus');
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
        st.style.color = '#dc2626'; st.textContent = 'Format URL tidak sesuai (harus diakhiri /exec).'; return;
      }
      var prev = syncUrl;
      syncUrl = url;
      st.style.color = '#16a34a'; st.textContent = 'Menguji koneksi...';
      getAny('ping').then(function (r) {
        if (!r || !r.ok) throw new Error('respon tidak dikenali');
        localStorage.setItem(LS_KEY_GAS, url);
        try { localStorage.setItem(LS_KEY_GAS_ALT, url); } catch (e) {}
        st.textContent = 'Tersambung ke server!';
        setTimeout(function () { modalEl.style.display = 'none'; }, 700);
      }).catch(function (err) {
        syncUrl = prev;
        st.style.color = '#dc2626'; st.textContent = 'Gagal: ' + err.message;
      });
    });
    document.body.appendChild(modalEl);
  }

  window.Sync = {
    setUrl: function (u) { if (u) { syncUrl = u; persistUrl(u); } },
    getUrl: function () { return syncUrl; },
    hasUrl: function () { return !!syncUrl; },
    get: getAny,
    save: function (app, payload) { return postJson(Object.assign({ app: app }, payload)); },
    settings: function (appLabel) {
      if (!modalEl) buildModal(appLabel || 'Aplikasi');
      modalEl.querySelector('#tvcSyncUrl').value = syncUrl;
      var st = modalEl.querySelector('#tvcSyncStatus');
      st.style.color = '#16a34a'; st.textContent = 'Masukkan URL lalu tekan Simpan & Tes.';
      modalEl.style.display = 'flex';
    },
    pollMs: POLL_MS
  };
})();