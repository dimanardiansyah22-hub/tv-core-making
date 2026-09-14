// ==UserScript==
// @name         BNF → Drive + QR
// @namespace    tvc-bnf-drive
// @version      0.4.0
// @description  Saat "Preview & Print" di bnf-info.vercel.app dipicu, buat PDF (html-to-image+jsPDF, tajam seperti print preview), upload ke Google Drive folder BNF, lalu tampilkan QR unduhan.
// @author       TV Core Making
// @match        https://bnf-info.vercel.app/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ============ KONFIGURASI ============ */
  var CONFIG = {
    backend: 'https://script.google.com/macros/s/AKfycbwhz_ltIGdXeJZ0qq44u8vamXR0X008SEQJO52K_qmZBY3JqJfFiMR4ohvHO51VfDgOlw/exec',
    driveFolder: 'https://drive.google.com/drive/folders/1gQq7PSGSEdZGDCPDCo2X4Vq8AlZROIPs',
    prefix: 'BNF'
  };
  /* ===================================== */

  var isPreview = /\/preview/i.test(location.pathname);

  var originalPrint = null;
  try { originalPrint = window.print && window.print.bind(window); } catch (e) {}

  var CDN = {
    htmlToImage: 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    qrcode: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
  };

  /* ---------- Util ---------- */
  function backendUrl() {
    try {
      var q = new URLSearchParams(location.search).get('gas');
      if (q) return q;
    } catch (e) {}
    try {
      var l = localStorage.getItem('bnf-gas-url');
      if (l) return l;
    } catch (e) {}
    return CONFIG.backend;
  }

  function sanitize(s, max) {
    return String(s || '').replace(/[\\/?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim().slice(0, max || 100);
  }

  function makeBaseName() {
    try {
      var raw = localStorage.getItem('bnf_form_data');
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.namaProblem) return CONFIG.prefix + ' - ' + sanitize(d.namaProblem);
      }
    } catch (e) {}
    return CONFIG.prefix;
  }

  function inject(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = function () { rej(new Error('Gagal memuat ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  var loadPromise = null;
  function ensureLibs() {
    if (!loadPromise) {
      loadPromise = Promise.all([
        window.htmlToImage ? Promise.resolve() : inject(CDN.htmlToImage),
        window.jspdf ? Promise.resolve() : inject(CDN.jspdf),
        window.QRCode ? Promise.resolve() : inject(CDN.qrcode)
      ]);
    }
    return loadPromise;
  }

  /* ---------- Hook window.print (awal + re-assert berkala) ---------- */
  var hooked = false;
  function installPrintHook() {
    hooked = true;
    try { window.print = function () { captureAndUpload(); }; } catch (e) {}
    // Beberapa framework bisa menimpa window.print setelah mount.
    // Re-assert tiap detik selama 15 detik agar tetap menang.
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (!hooked) { clearInterval(t); return; }
      try { if (window.print !== handler) window.print = handler; } catch (e) {}
      if (tries > 15) clearInterval(t);
    }, 1000);
    function handler() { captureAndUpload(); }
  }

  /* ---------- Modal UI ---------- */
  var modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'bnfDriveModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    modal.innerHTML =
      '<div style="background:#fff;border-radius:14px;width:min(92vw,430px);padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center">' +
      '<h3 style="margin:0 0 4px;font-size:17px;font-weight:800;color:#111827">BNF → Google Drive</h3>' +
      '<div id="bnfStatus" style="min-height:20px;font-size:13px;font-weight:600;color:#16a34a;margin-top:8px"></div>' +
      '<div id="bnfQr" style="display:flex;align-items:center;justify-content:center;min-height:190px;margin:10px auto 4px"></div>' +
      '<div id="bnfMeta" style="font-size:11px;color:#6b7280;min-height:14px;margin-bottom:12px"></div>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<button id="bnfOpenDrive" style="display:none;border:none;background:#2563eb;color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Buka Folder Drive</button>' +
      '<button id="bnfDownload" style="display:none;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Unduh di Perangkat Ini</button>' +
      '<button id="bnfPrintOrig" style="display:none;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Cetak Asli</button>' +
      '<button id="bnfClose" style="border:none;background:transparent;color:#6b7280;border-radius:8px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer">Tutup</button>' +
      '</div></div>';
    modal.querySelector('#bnfClose').addEventListener('click', function () { modal.style.display = 'none'; });
    modal.querySelector('#bnfOpenDrive').addEventListener('click', function () { window.open(CONFIG.driveFolder, '_blank'); });
    modal.querySelector('#bnfPrintOrig').addEventListener('click', function () {
      modal.style.display = 'none';
      if (originalPrint) { try { originalPrint(); } catch (e) {} }
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
    document.documentElement.appendChild(modal);
    return modal;
  }

  function setStatus(msg, isErr) {
    var st = modal.querySelector('#bnfStatus');
    st.textContent = msg;
    st.style.color = isErr ? '#dc2626' : '#16a34a';
  }

  function showModal() {
    ensureModal();
    modal.querySelector('#bnfQr').innerHTML = '<span style="font-size:12px;color:#9ca3af">—</span>';
    modal.querySelector('#bnfMeta').textContent = '';
    modal.querySelector('#bnfOpenDrive').style.display = 'none';
    modal.querySelector('#bnfDownload').style.display = 'none';
    modal.querySelector('#bnfPrintOrig').style.display = isPreview && originalPrint ? 'inline-block' : 'none';
    modal.style.display = 'flex';
  }

  /* ---------- PDF: capture + upload ---------- */
  function buildDataPdf(d) {
    var pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    var M = 12, W = 186, lh = 4.4, y = 15;
    function put(text, x, w) {
      var lines = pdf.splitTextToSize(String(text || ''), w);
      for (var i = 0; i < lines.length; i++) {
        if (y > 285) { pdf.addPage(); y = 14; }
        pdf.text(lines[i], x, y);
        y += lh;
      }
    }
    function sec(t) {
      if (t) { y += 2.5; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); put(t, M, W); }
    }
    function field(label, val) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
      var lw = 62;
      pdf.text(label + ':', M, y + 1);
      pdf.setFont('helvetica', 'normal');
      put(val === true ? 'Ya' : (val === false ? 'Tidak' : (val || '-')), M + lw, W - lw);
      y += 0.8;
    }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
    pdf.text('FORM BNF', 105, y, { align: 'center' }); y += 5;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    pdf.text('Engine Production Sunter Division', 105, y, { align: 'center' }); y += 5;

    var shName = d.sh === 'joko' ? 'Joko Kistanto' : (d.sh === 'widodo' ? 'Widodo Purnomo' : (d.sh || '-'));

    sec('Kategori');
    var kats = [['Problem Safety', d.kategoriSafety], ['Problem Kualitas', d.kategoriKualitas], ['Problem Mesin', d.kategoriMesin], ['Lain-Lain', d.kategoriLainLain]]
      .filter(function (a) { return a[1]; }).map(function (a) { return a[0]; }).join('; ') || '-';
    field('Kategori', kats);
    field('Tanggal', d.tanggal); field('Area', d.area); field('Line', d.line);
    sec('Identifikasi Masalah');
    field('Nama Problem', d.namaProblem); field('Lokasi Kejadian', d.lokasiKejadian);
    field('Nama Part / Mesin', d.namaPartMesin); field('Tanggal & Waktu', d.tanggalWaktu);
    field('Penanggung Jawab', d.penanggungJawab);
    sec('Khusus Problem Outsource');
    field('Nama Part', d.namaPart); field('Supplier', d.supplier);
    sec('Kronologis Kejadian'); field('', d.kronologisKejadian);
    sec('Ilustrasi'); field('', d.ilustrasi);
    sec('Penyebab'); field('', d.penyebab);
    sec('Dampak'); field('', d.dampak);
    sec('Penanganan Sementara'); field('', d.penangananSementara);
    sec('Follow Up'); field('', d.followUp);
    sec('Kondisi Stock'); field('', d.kondisiStock);
    sec('Koordinasi dengan Divisi Lain');
    var ko = [['PAD', d.koordinasiPAD], ['PBOD', d.koordinasiPBOD], ['PCD', d.koordinasiPCD], ['PUD', d.koordinasiPUD], ['Others', d.koordinasiOthers]]
      .filter(function (a) { return a[1]; }).map(function (a) { return a[0]; }).join('; ');
    field('Koordinasi', ko + (d.koordinasiOthers && d.koordinasiOthersText ? ' - ' + d.koordinasiOthersText : ''));
    sec('Informasi Tambahan');
    var info = [['1. Ada rekam jejak di masa lalu (tidak ada komplain)', d.c1],
      ['2. Terbukti dalam durability test dan pengujian lainnya', d.c2],
      ['3. Hasil pembongkaran: Tidak ada perubahan', d.c3],
      ['4. Operasi T/T ± 2/3 putaran: Tidak masalah', d.c4],
      ['5. Tidak ada masalah dalam hal fungsi dan struktur', d.c5],
      ['6. Tidak ada dampak pada kendaraan / mobil', d.c6],
      ['7. Lain-lain', d.c7]]
      .map(function (a) { return (a[1] ? '[x] ' : '[ ] ') + a[0]; }).join('\n');
    put(info, M, W);
    if (d.c7 && d.c7Text) field('Keterangan Lain-lain', d.c7Text);
    sec('Tanda Tangan');
    field('DpH', 'Aldino');
    field('SH', shName);
    return pdf.output('datauristring').split(',')[1];
  }

  function buildPdf(canvas) {
    // Margin 0.5 inci (12.7mm) MERATA di kiri, kanan, atas, bawah kertas A4.
    // Form diskala agar seluruhnya muat di dalam area margin tsb (aspek dijaga).
    return new Promise(function (res, rej) {
      try {
        var M = 12.7; // 0.5 inch
        var pw = 210, ph = 297;
        var avw = pw - 2 * M, avh = ph - 2 * M;
        var ratio = canvas.height / canvas.width;
        var w, h;
        if (ratio > avh / avw) { h = avh; w = h / ratio; }
        else { w = avw; h = w * ratio; }
        var x = M + (avw - w) / 2, y = M + (avh - h) / 2;
        var pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', x, y, w, h);
        // Jamin border luar terlihat utuh di keempat sisi (atas/kiri/bawah/kanan).
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.4);
        pdf.rect(x, y, w, h);
        res(pdf.output('datauristring').split(',')[1]);
      } catch (e) { rej(e); }
    });
  }

  function findVisibleSheet() {
    // Lembar A4 yang SEDANG TERLIHAT di area preview layar (.bg-gray-300),
    // bukan .print-only (display:none yang bikin library gambar gagal).
    var cand = document.querySelectorAll('div');
    for (var i = 0; i < cand.length; i++) {
      var d = cand[i], st = d.style || {};
      if (st.width && /mm/i.test(st.width) && d.offsetWidth > 100 && d.offsetHeight > 100) return d;
    }
    return null;
  }

  function captureSheetPdf() {
    // Tangkap BLOK area preview (.bg-gray-300): lembar form + ruang putih
    // sekelilingnya → seluruh border luar ikut ter-capture (tidak terpotong).
    // Background abu-abu diputihkan sementara, lalu dipulihkan.
    // Fallback: lembar itu sendiri.
    var el = document.querySelector('.bg-gray-300') || findVisibleSheet();
    if (!el) return Promise.resolve(null);
    var prevBg = (el.style && el.style.backgroundColor) || '';
    el.style.backgroundColor = '#ffffff';
    var fab = document.getElementById('bnfDriveFab');
    var oldFabD = fab ? fab.style.display : null;
    if (fab) fab.style.display = 'none';
    function restore() {
      if (el.style) el.style.backgroundColor = prevBg;
      if (fab) fab.style.display = oldFabD;
    }
    function shoot() {
      return window.htmlToImage.toJpeg(el, {
        pixelRatio: 3,
        quality: 1,
        backgroundColor: '#ffffff',
        useCORS: true,
        style: { margin: '0', padding: '0', border: '0', boxShadow: 'none' }
      }).then(function (dataUrl) { restore(); return dataUrl; })
        .catch(function (e) { restore(); throw e; });
    }
    return shoot();
  }

  function trimSheetCanvas(dataUrl) {
    // Potong gambar sampai batas isi form (buang ruang kosong dari capture),
    // supaya bisa di-center rapi di halaman.
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width, h = img.height;
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var d = ctx.getImageData(0, 0, w, h).data;
          var minX = w, minY = h, maxX = -1, maxY = -1;
          var step = Math.max(2, Math.round(w / 300));
          for (var y = 0; y < h; y += step) {
            var row = y * w * 4;
            for (var x = 0; x < w; x += step) {
              var i = row + x * 4;
              if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 240) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < 0) throw new Error('Isi form kosong');
          var out = document.createElement('canvas');
          out.width = maxX - minX + 1;
          out.height = maxY - minY + 1;
          out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
          res(out);
        } catch (e) { rej(e); }
      };
      img.onerror = function () { rej(new Error('Gagal membaca hasil capture')); };
      img.src = dataUrl;
    });
  }

  function captureAndUpload() {
    showModal();
    setStatus('Menyusun PDF BNF...');
    setTimeout(function () {
      ensureLibs().then(function () {
        return captureSheetPdf();
      }).then(function (dataUrl) {
        if (!dataUrl) { throw new Error('Lembar tampilan tidak ditemukan'); }
        return trimSheetCanvas(dataUrl);
      }).then(function (canvas) {
        return buildPdf(canvas);
      }).then(function (b64) {
        upload(b64);
      }).catch(function (err) {
        // Cadangan: bangun dari data form bila capture gagal.
        var d = null;
        try { d = JSON.parse(localStorage.getItem('bnf_form_data')); } catch (e) {}
        if (d) { upload(buildDataPdf(d)); return; }
        setStatus('Gagal membuat PDF: ' + err.message, true);
        modal.querySelector('#bnfPrintOrig').style.display = isPreview && originalPrint ? 'inline-block' : 'none';
      });
    }, 500);
  }

  function upload(b64) {
    setStatus('Mengunggah ke Google Drive...');
    fetch(backendUrl(), {
      method: 'POST',
      body: JSON.stringify({ app: 'bnf', action: 'savepdf', name: makeBaseName(), b64: b64 }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow'
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Server menolak');
      var link = 'https://drive.google.com/file/d/' + res.id + '/view';
      setStatus('Tersimpan di Drive ✓');
      modal.querySelector('#bnfMeta').textContent = res.name + ' — scan QR dari HP untuk mengunduh.';
      var box = modal.querySelector('#bnfQr');
      box.innerHTML = '';
      new window.QRCode(box, { text: link, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M });
      modal.querySelector('#bnfOpenDrive').style.display = 'inline-block';
      var dl = modal.querySelector('#bnfDownload');
      var blob;
      try {
        var bin = atob(b64);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        blob = new Blob([arr], { type: 'application/pdf' });
      } catch (e) {}
      if (blob) {
        dl.style.display = 'inline-block';
        dl.onclick = function () {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = res.name;
          a.click();
        };
      }
    }).catch(function (err) {
      setStatus('Gagal unggah: ' + err.message, true);
      modal.querySelector('#bnfPrintOrig').style.display = isPreview && originalPrint ? 'inline-block' : 'none';
    });
  }

  /* ---------- Tombol melayang "Drive+QR" (cadangan) ---------- */
  function addFloatingButton() {
    var prev = document.querySelectorAll('#bnfDriveFab');
    for (var i = 0; i < prev.length; i++) if (prev[i].parentNode) prev[i].parentNode.removeChild(prev[i]);
    var btn = document.createElement('button');
    btn.id = 'bnfDriveFab';
    btn.title = 'Simpan ke Google Drive + QR';
    btn.textContent = '📤 Drive+QR';
    btn.style.cssText = 'position:fixed;right:16px;bottom:70px;z-index:2147483646;background:#0b7439;color:#fff;border:none;border-radius:20px;padding:10px 16px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    btn.addEventListener('click', captureAndUpload);
    document.body.appendChild(btn);
  }
  if (document.body) addFloatingButton();
  else document.addEventListener('DOMContentLoaded', addFloatingButton);

  installPrintHook();
  console.log('[BNF-Drive] load ok. preview=', isPreview);
})();