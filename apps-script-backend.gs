/***************************************************************
 * Google Apps Script — Backend Terpusat TV Core Making
 *
 * Satu deployment Web App melayani semua aplikasi:
 *   - Mapping Pekerjaan Core (red / white)
 *   - Capability & Proses per posisi (red / white, via app=corecap)
 *   - Visualisasi WIP Core (pagi / malam)
 *   - Planning Cuti Core (red / white)
 *   - Laporan Antar Shift (PNG + metadata di Drive) [legacy]
 *
 * Cara pakai:
 * 1. Buka script.google.com, buat project baru (Drive diizinkan).
 * 2. Tempel kode ini.
 * 3. Deploy → New deployment → Web App.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Salin URL /exec. Tempel di Pengaturan tiap aplikasi.
 *
 * RUTE — GET (mendukung JSONP via &callback=...):
 *   ?app=ping                                     → {ok:true,pong:true}
 *   ?app=mapping&core=red&action=get              → {ok:true,data:{...}}
 *   ?app=wip&shift=pagi&action=get                → {ok:true,data:{...}}
 *   ?app=planning-cuti&core=red&action=get        → {ok:true,data:{...}}
 *   ?app=laporan&action=list                      → {ok:true,reports:[...]}
 *   ?app=laporan&action=get&id=...                → {ok:true,image:...}
 *   ?app=laporan&action=pdf&id=...                → {ok:true,b64:...}
 *
 *   Catatan: jika param `app` tidak dikirim, default = laporan
 *   (agar client lama yang memanggil ?action=... tetap berfungsi).
 *
 * RUTE — POST (JSON, untuk simpan data besar / konsisten):
 *   {"app":"mapping","core":"red","action":"save","data":{...}}
 *   {"app":"wip","shift":"pagi","action":"save","data":{...}}
 *   {"app":"planning-cuti","core":"red","action":"save","data":{...}}
 *   {"app":"laporan","action":"save"|"update", ...}
 ***************************************************************/

/* ── Konstanta folder & file data ── */
var FOLDER_NAME = 'Laporan Antar Shift';
// Folder arsip resmi (terhubung langsung via ID):
// https://drive.google.com/drive/folders/1083kkZheBCdzTG0N7FKELbwZnn-J6MSS
var FOLDER_ID = '1083kkZheBCdzTG0N7FKELbwZnn-J6MSS';
// Khusus PDF ringkasan Visualisasi WIP Core (terpisah dari laporan antar shift)
// https://drive.google.com/drive/folders/14RPYmYBAddif5TO3NSZoRUP7EEHof7Bm
var WIP_FOLDER_ID = '14RPYmYBAddif5TO3NSZoRUP7EEHof7Bm';
// Folder khusus BNF dari bnf-info.vercel.app (dibuat user)
// https://drive.google.com/drive/folders/1gQq7PSGSEdZGDCPDCo2X4Vq8AlZROIPs
var BNF_FOLDER_ID = '1gQq7PSGSEdZGDCPDCo2X4Vq8AlZROIPs';
var DATA_FOLDER_NAME = 'TV Core Making Data';

var DOC_NAMES = {
  mapping_red: 'mapping-red.json',
  mapping_white: 'mapping-white.json',
  wip_pagi: 'wip-pagi.json',
  wip_malam: 'wip-malam.json',
  planning_red: 'planning-cuti-red.json',
  planning_white: 'planning-cuti-white.json',
  machines: 'machines.json',
  capability_red: 'capability-red.json',
  capability_white: 'capability-white.json'
};

/* ══════════════════════════════════════════════════════════════
   T R A F I K  M A S U K
   ══════════════════════════════════════════════════════════════ */

function doGet(e) {
  var p = e.parameter || {};
  var app = p.app || 'laporan';
  var action = p.action || 'ping';
  var callback = p.callback;
  var result;

  if (action === 'ping') {
    result = { ok: true, pong: true, app: app };
  } else if (action === 'status') {
    result = statusReport_();
  } else if (app === 'laporan') {
    result = laporanGet_(p);
  } else if (app === 'wipreport') {
    if (action === 'list') result = listWipPdfs_();
    else if (action === 'getpdf') result = getWipPdf_(p.id);
    else result = { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'oeedata') {
    if (action === 'list') result = listOeeData_(p);
    else if (action === 'delete') result = deleteOeeData_(p);
    else result = { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'mapping') {
    result = (action === 'get') ? appGet_('mapping', p.core) : { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'machines') {
    result = (action === 'get') ? docGet_('machines') : { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'wip') {
    result = (action === 'get') ? appGet_('wip', p.shift) : { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'planning-cuti') {
    result = (action === 'get') ? appGet_('planning', p.core) : { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'corecap') {
    result = (action === 'get') ? appGet_('capability', p.core) : { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else if (app === 'bnf') {
    if (action === 'list') result = listBnfPdfs_();
    else if (action === 'getpdf') result = getWipPdf_(p.id);
    else result = { ok: false, error: 'Aksi tidak dikenal: ' + action };
  } else {
    result = { ok: false, error: 'App tidak dikenal: ' + app };
  }

  return output_(result, callback);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return output_({ ok: false, error: 'Format JSON salah' });
  }
  var app = body.app || 'laporan';
  var action = body.action || 'save';
  var callback = body.callback;
  var result;

  if (app === 'laporan') {
    if (action === 'save') result = saveReport_(body);
    else if (action === 'update') result = updateReport_(body);
    else result = { ok: false, error: 'Aksi POST tidak dikenal: ' + action };
  } else if (app === 'wipreport' && action === 'savepdf') {
    result = saveWipPdf_(body);
  } else if (app === 'asakaireport' && action === 'savepdf') {
    result = saveAsakaiPdf_(body);
  } else if (app === 'bnf' && action === 'savepdf') {
    result = saveBnfPdf_(body);
  } else if (app === 'oeedata' && action === 'save') {
    result = saveOeeData_(body);
  } else if (app === 'oeedata' && action === 'delete') {
    result = deleteOeeData_(body);
  } else if (app === 'mapping') {
    result = appSave_('mapping', body.core, body.data);
  } else if (app === 'machines' && action === 'save') {
    result = appSave_('machines', null, body.data);
  } else if (app === 'wip') {
    result = appSave_('wip', body.shift, body.data);
  } else if (app === 'planning-cuti') {
    result = appSave_('planning', body.core, body.data);
  } else if (app === 'corecap') {
    result = appSave_('capability', body.core, body.data);
  } else {
    result = { ok: false, error: 'App tidak dikenal: ' + app };
  }

  return output_(result, callback);
}

/* ══════════════════════════════════════════════════════════════
   APLIKASI DATA (mapping / wip / planning-cuti)
   Satu dokumen JSON per koleksi, versi last-write-wins.
   Setiap simpan menulis `updatedAt` untuk polling antar device.
   ══════════════════════════════════════════════════════════════ */

function appKey_(app, variant) {
  if (app === 'mapping') return (variant === 'white') ? DOC_NAMES.mapping_white : DOC_NAMES.mapping_red;
  if (app === 'wip') return (variant === 'malam') ? DOC_NAMES.wip_malam : DOC_NAMES.wip_pagi;
  if (app === 'planning') return (variant === 'white') ? DOC_NAMES.planning_white : DOC_NAMES.planning_red;
  if (app === 'machines') return DOC_NAMES.machines;
  if (app === 'capability') return (variant === 'white') ? DOC_NAMES.capability_white : DOC_NAMES.capability_red;
  return null;
}

function appGet_(app, variant) {
  var name = appKey_(app, variant);
  if (!name) return { ok: false, error: 'Koleksi tidak dikenal' };
  return docGet_(name);
}

function appSave_(app, variant, data) {
  var name = appKey_(app, variant);
  if (!name) return { ok: false, error: 'Koleksi tidak dikenal' };
  if (!data || typeof data !== 'object') return { ok: false, error: 'Data kosong' };
  data.updatedAt = new Date().toISOString();
  writeDoc_(name, data);
  return { ok: true, updatedAt: data.updatedAt };
}

function docGet_(name) {
  var doc = readDoc_(name);
  return { ok: true, data: doc };
}

/* ── Dokumen Drive: baca/tulis JSON ── */
function getDataFolder_() {
  var it = DriveApp.getFoldersByName(DATA_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(DATA_FOLDER_NAME);
}

function getDocFile_(name) {
  var it = getDataFolder_().getFilesByName(name);
  if (it.hasNext()) return it.next();
  return getDataFolder_().createFile(name, '{}', 'application/json');
}

function readDoc_(name) {
  try {
    var file = getDocFile_(name);
    var text = file.getBlob().getDataAsString();
    return JSON.parse(text || '{}');
  } catch (e) {
    return {};
  }
}

function writeDoc_(name, obj) {
  var file = getDocFile_(name);
  file.setContent(JSON.stringify(obj));
}

/* ══════════════════════════════════════════════════════════════
   LAPORAN ANTAR SHIFT (legacy, dipertahankan)
   ══════════════════════════════════════════════════════════════ */

function laporanGet_(p) {
  var action = p.action;
  if (action === 'pdf') return getFormPdf_(p.id);
  if (action === 'list') return listReports_();
  if (action === 'get') return getReport_(p.id);
  return { ok: false, error: 'Aksi tidak dikenal: ' + action };
}

function getReport_(id) {
  if (!id) return { ok: false, error: 'id kosong' };
  var rec = loadRecord_(id);
  if (!rec || !rec.fileId) return { ok: false, error: 'Laporan tidak ditemukan' };
  try {
    var file = DriveApp.getFileById(rec.fileId);
    var bytes = file.getBlob().getBytes();
    var b64 = Utilities.base64Encode(bytes);
    var mime = file.getMimeType();
    var prefix = mime === 'image/jpeg' ? 'data:image/jpeg;base64,' : 'data:image/png;base64,';
    return { ok: true, image: prefix + b64 };
  } catch (err) {
    return { ok: false, error: 'Gagal membaca file: ' + err.message };
  }
}

/* ── Simpan laporan ── */
function saveReport_(data) {
  var date = data.date || '';
  var shift = data.shift || '';
  var author = data.author || '';
  var note = data.note || '';
  var image = data.image || '';

  if (!date || !author || !image) {
    return { ok: false, error: 'Data tanggal, nama, atau gambar belum lengkap' };
  }

  var id = Utilities.getUuid();
  var ts = new Date().toISOString();

  try {
    var base64 = image.split(',')[1] || image;
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'laporan-antar-shift-' + ts + '.png');
    var folder = getFolder_();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var record = {
      id: id,
      date: date,
      shift: shift,
      author: author,
      note: note,
      fileId: file.getId(),
      ts: ts
    };
    saveRecord_(record);
    return { ok: true, id: id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Simpan PDF ringkasan WIP Core ke folder khusus WIP ──
   Dipakai tombol "Generate to PDF" di visualisasi-wip-core.html.
   File dibagikan ANYONE_WITH_LINK agar QR code bisa mengunduhnya.
   Jika data.temp = true (generate pada jam tertentu), file masuk
   subfolder Temp dengan akhiran -TEMP-<expiryMs> dan dibersihkan
   otomatis setelah lewat 1 jam. */
function getWipFolder_() {
  try {
    return DriveApp.getFolderById(WIP_FOLDER_ID);
  } catch (e) { /* akses ditolak / tidak ada → buat folder pemisah */ }
  var it = DriveApp.getFoldersByName('Visualisasi WIP Core');
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder('Visualisasi WIP Core');
}

function getWipTempFolder_() {
  var root = getWipFolder_();
  var it = root.getFoldersByName('Temp');
  return it.hasNext() ? it.next() : root.createFolder('Temp');
}

/* Hapus PDF sementara yang sudah melewati batas 1 jam */
function cleanupTempPdfs_() {
  try {
    var it = getWipTempFolder_().getFiles();
    var now = Date.now();
    while (it.hasNext()) {
      var f = it.next();
      var m = f.getName().match(/-TEMP-(\d+)\.pdf$/);
      if (m && now > parseInt(m[1], 10)) f.setTrashed(true);
    }
  } catch (e) {}
}

function saveWipPdf_(data) {
  var b64 = data.b64 || '';
  if (!b64) return { ok: false, error: 'PDF kosong' };
  cleanupTempPdfs_(); // sekalian bersihkan sisa file sementara
  try {
    var name = data.name || 'Report Daily Production Core Making.pdf';
    var folder = getWipFolder_();
    if (data.temp) {
      var expiry = Date.now() + 60 * 60 * 1000; // berlaku 1 jam
      name = name.replace(/\.pdf$/i, '') + '-TEMP-' + expiry + '.pdf';
      folder = getWipTempFolder_();
    }
    // Replace PDF sebelumnya untuk shift + tanggal + mode yang sama,
    // supaya file tidak menumpuk di Drive.
    var base = name.replace(/-TEMP-\d+\.pdf$/i, '').replace(/\.pdf$/i, '').toLowerCase();
    var files = folder.getFiles();
    while (files.hasNext()) {
      var ex = files.next();
      var exName = ex.getName().toLowerCase();
      var exBase = exName.replace(/-TEMP-\d+\.pdf$/i, '').replace(/\.pdf$/i, '');
      if (exBase === base) ex.setTrashed(true);
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', name);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, id: file.getId(), temp: !!data.temp };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Simpan PDF laporan OEE Asakai ke folder khusus "Asakai" ──
   Dipakai tombol "Buat PDF Asakai" di data-oee.html.
   Folder dibuat otomatis bila belum ada. File dibagikan ANYONE_WITH_LINK.
   PDF sebelumnya dgn nama dasar yg sama diganti supaya tidak menumpuk. */
var ASAKAI_FOLDER_ID = '1xFZSrZ5JbOGjnflJhHaRgihybqIHKM-q';
function getAsakaiFolder_() {
  try {
    return DriveApp.getFolderById(ASAKAI_FOLDER_ID);
  } catch (e) { /* akses ditolak / tidak ada → cari atau buat */ }
  try {
    var it = DriveApp.getFoldersByName('Asakai');
    if (it.hasNext()) return it.next();
  } catch (e2) { /* lanjut buat baru */ }
  return DriveApp.createFolder('Asakai');
}

function saveAsakaiPdf_(data) {
  var b64 = data.b64 || '';
  if (!b64) return { ok: false, error: 'PDF kosong' };
  try {
    var name = data.name || 'Laporan OEE Core Making - Asakai.pdf';
    var folder = getAsakaiFolder_();
    var base = name.replace(/\.pdf$/i, '').toLowerCase();
    var files = folder.getFiles();
    while (files.hasNext()) {
      var ex = files.next();
      if (ex.getName().toLowerCase().replace(/\.pdf$/i, '') === base) ex.setTrashed(true);
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', name);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, id: file.getId(), folderId: folder.getId() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Daftar PDF WIP (folder utama + subfolder Temp) ── */
function listWipPdfs_() {
  try {
    var rows = [];
    var root = getWipFolder_();
    var tempFolder = null;
    var fit = root.getFoldersByName('Temp');
    if (fit.hasNext()) tempFolder = fit.next();
    function collect(files, isTemp) {
      while (files.hasNext()) {
        var f = files.next();
        var nm = f.getName();
        if (f.getMimeType() !== 'application/pdf' && !/\.pdf$/i.test(nm)) continue;
        rows.push({
          id: f.getId(),
          name: nm,
          ts: f.getDateCreated().toISOString(),
          size: f.getSize(),
          temp: isTemp || /-TEMP-\d+\.pdf$/i.test(nm)
        });
      }
    }
    collect(root.getFiles(), false);
    if (tempFolder) collect(tempFolder.getFiles(), true);
    rows.sort(function (a, b) { return b.ts.localeCompare(a.ts); });
    return { ok: true, reports: rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Ambil isi PDF WIP (base64) untuk dibuka di aplikasi ── */
function getWipPdf_(id) {
  if (!id) return { ok: false, error: 'id kosong' };
  try {
    var f = DriveApp.getFileById(id);
    return { ok: true, name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ══════════════════════════════════════════════════════════════
   BNF → DRIVE (dari bnf-info.vercel.app via userscript)
   PDF BNF dikumpulkan di folder BNF_FOLDER_ID, nama unik
   (ber-imestamp) agar setiap BNF terekam, tidak saling menimpa.
   ══════════════════════════════════════════════════════════════ */

function saveBnfPdf_(data) {
  var b64 = data.b64 || '';
  if (!b64) return { ok: false, error: 'PDF kosong' };
  try {
    var folder = DriveApp.getFolderById(BNF_FOLDER_ID);
    var base = String(data.name || 'Form BNF').replace(/\.pdf$/i, '').replace(/[\\/?%*:|"<>]/g, '-').slice(0, 120);
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
    var name = base + ' ' + stamp + '.pdf';
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', name);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, id: file.getId(), name: file.getName() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function listBnfPdfs_() {
  try {
    var rows = [];
    var it = DriveApp.getFolderById(BNF_FOLDER_ID).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getMimeType() !== 'application/pdf') continue;
      rows.push({
        id: f.getId(),
        name: f.getName(),
        ts: f.getDateCreated().toISOString(),
        size: f.getSize()
      });
    }
    rows.sort(function (a, b) { return b.ts.localeCompare(a.ts); });
    return { ok: true, reports: rows };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ══════════════════════════════════════════════════════════════
   DATA OEE CORE (histori OEE + daftar problem line stop)
   Dokumen: satu JSON `oee-data.json` berbentuk:
     { "YYYY-MM-DD": { "pagi": {...}, "malam": {...} } }
   Hanya disimpan saat PDF FINAL (akhir produksi), bukan temp.
   ══════════════════════════════════════════════════════════════ */
var OEE_DOC = 'oee-data.json';

function oeeKey_(date) {
  return String(date || '');
}

function saveOeeData_(data) {
  try {
    var date = oeeKey_(data.date);
    var shift = (data.shift === 'malam') ? 'malam' : 'pagi';
    if (!date) return { ok: false, error: 'Tanggal produksi kosong' };
    var doc = readDoc_(OEE_DOC);
    if (!doc[date]) doc[date] = { pagi: null, malam: null };
    doc[date][shift] = {
      oee: data.oee != null ? Number(data.oee) : null,
      av: data.av != null ? Number(data.av) : null,
      pe: data.pe != null ? Number(data.pe) : null,
      rq: data.rq != null ? Number(data.rq) : null,
      plannedMinutes: data.plannedMinutes != null ? Number(data.plannedMinutes) : null,
      machines: Array.isArray(data.machines) ? data.machines : [],
      problems: Array.isArray(data.problems) ? data.problems : [],
      savedAt: new Date().toISOString()
    };
    writeDoc_(OEE_DOC, doc);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Hapus data OEE: per tanggal + shift (pagi/malam) ── */
function deleteOeeData_(data) {
  try {
    var date = oeeKey_(data.date);
    var shift = (data.shift === 'malam') ? 'malam' : 'pagi';
    if (!date) return { ok: false, error: 'Tanggal produksi kosong' };
    var doc = readDoc_(OEE_DOC);
    if (!doc[date]) return { ok: true, deleted: false };
    var deleted = doc[date][shift] != null;
    delete doc[date][shift];
    if (!doc[date].pagi && !doc[date].malam) delete doc[date];
    writeDoc_(OEE_DOC, doc);
    return { ok: true, deleted: deleted, date: date, shift: shift };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Daftar histori OEE: kembalikan semua tanggal yang punya data ── */
function listOeeData_(p) {
  try {
    var doc = readDoc_(OEE_DOC);
    var dates = Object.keys(doc).sort().reverse();
    var machines = [];
    try {
      var mdoc = readDoc_(DOC_NAMES.machines);
      if (Array.isArray(mdoc.machines)) machines = mdoc.machines;
    } catch (e2) {}
    return { ok: true, dates: dates, store: doc, machines: machines };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Perbarui laporan (ganti gambar, fileId baru) ── */
function updateReport_(data) {
  var id = data.id || '';
  var image = data.image || '';
  if (!id || !image) {
    return { ok: false, error: 'Data id atau gambar belum lengkap' };
  }
  var rec = loadRecord_(id);
  if (!rec || !rec.fileId) {
    return { ok: false, error: 'Laporan tidak ditemukan' };
  }
  try {
    var base64 = image.split(',')[1] || image;
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'laporan-antar-shift-' + id + '.png');
    var folder = getFolder_();

    // Kelas File tidak punya setBlob — cara paling andal menimpa gambar
    // adalah hapus file lama lalu buat file baru (fileId ikut berubah).
    var oldFile = DriveApp.getFileById(rec.fileId);
    oldFile.setTrashed(true);

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var updated = {
      id: rec.id,
      date: rec.date,
      shift: rec.shift,
      author: rec.author,
      note: data.note !== undefined ? data.note : rec.note,
      fileId: file.getId(),
      ts: new Date().toISOString()
    };
    saveRecord_(updated);
    return { ok: true, id: id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ── Daftar laporan ── */
/* ── Diagnostik: buka URL/exec?action=status di browser ──
   Menunjukkan folder mana yang benar-benar dipakai script dan
   berapa file/metada yang terlihat, untuk memastikan kenapa
   arsip kosong. */
function statusReport_() {
  var info = { ok: true };
  try {
    var byId = DriveApp.getFolderById(FOLDER_ID);
    info.folderById = true;
    info.folderName = byId.getName();
    info.folderUrl = byId.getUrl();
  } catch (e) {
    info.folderById = false;
    info.folderError = e.message;
    try {
      var itn = DriveApp.getFoldersByName(FOLDER_NAME);
      info.fallbackFound = itn.hasNext();
      if (itn.hasNext()) {
        var fb = itn.next();
        info.folderName = fb.getName();
        info.folderUrl = fb.getUrl();
      }
    } catch (e2) {}
  }
  try { info.metaCount = readAllRecords_().length; } catch (e) { info.metaCount = -1; }
  try {
    var files = getFolder_().getFiles();
    var total = 0, imgs = 0;
    while (files.hasNext()) {
      var fl = files.next();
      total++;
      var nm = fl.getName(), mm = fl.getMimeType();
      if (mm === 'image/png' || mm === 'image/jpeg' ||
          /\.png$/i.test(nm) || /\.jpe?g$/i.test(nm)) imgs++;
    }
    info.fileCount = total;
    info.imageCount = imgs;
  } catch (e) { info.fileCount = -1; }
  return info;
}

function listReports_() {
  syncFolderFiles_(); // impor file lama di folder arsip agar ikut tampil
  var rows = [];  var raw = readAllRecords_();
  for (var i = 0; i < raw.length; i++) {
    var r = raw[i];
    rows.push({
      id: r.id,
      date: r.date,
      shift: r.shift,
      author: r.author,
      note: r.note,
      ts: r.ts
    });
  }
  rows.sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || ''); });
  return { ok: true, reports: rows };
}

/* ══════════════════════════════════════════════
   Penyimpanan metadata laporan: file JSON di Drive
   (Menghindari ScriptDb yang deprecated & SpreadsheetApp
   yang butuh scope tambahan. Drive scope sudah dipakai,
   jadi tidak perlu otorisasi ulang.)
   Gambar tetap disimpan sebagai file PNG di Drive.
   ══════════════════════════════════════════════ */
var DB_FILE_NAME = 'Laporan Antar Shift Metadata.json';

function getMetaFile_() {
  var files = DriveApp.getFilesByName(DB_FILE_NAME);
  if (files.hasNext()) return files.next();
  var folder = getFolder_();
  return folder.createFile(DB_FILE_NAME, '[]', 'application/json');
}

function readAllRecords_() {
  try {
    var file = getMetaFile_();
    var text = file.getBlob().getDataAsString();
    var arr = JSON.parse(text || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeAllRecords_(records) {
  var file = getMetaFile_();
  file.setContent(JSON.stringify(records));
}

function saveRecord_(record) {
  var records = readAllRecords_();
  var found = false;
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].id) === String(record.id)) {
      records[i] = record;
      found = true;
      break;
    }
  }
  if (!found) records.push(record);
  writeAllRecords_(records);
}

function loadRecord_(id) {
  var records = readAllRecords_();
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].id) === String(id)) return records[i];
  }
  return null;
}

/* ══════════════════════════════════════════════
   Helper
   ══════════════════════════════════════════════ */
function getFolder_() {
  // Utamakan folder resmi via ID (selalu sama meski namanya diubah)
  try {
    return DriveApp.getFolderById(FOLDER_ID);
  } catch (e) { /* folder tidak ditemukan / akses ditolak → lanjut pencarian nama */ }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

/* ── Impor file gambar lama di folder arsip ke metadata ──
   File PNG/JPG yang sudah ada di folder (upload manual atau dari
   versi lama) tidak punya catatan metadata, jadi tidak muncul di
   Arsip. Fungsi ini menambahkan satu record per file yang belum
   terdaftar, lalu menyimpannya permanen ke metadata. */
function syncFolderFiles_() {
  var records;
  try {
    records = readAllRecords_();
    if (!records.length) getMetaFile_(); // pastikan metadata siap ditulis
  } catch (e) { return; }
  var known = {};
  for (var i = 0; i < records.length; i++) {
    if (records[i].fileId) known[String(records[i].fileId)] = true;
    if (records[i].id) known[String(records[i].id)] = true;
  }
  var added = false;
  var it = getFolder_().getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var fid = String(f.getId());
    if (known[fid]) continue; // sudah terdaftar
    var name = f.getName();
    var mime = f.getMimeType();
    var isImg = mime === 'image/png' || mime === 'image/jpeg' ||
                /\.png$/i.test(name) || /\.jpe?g$/i.test(name);
    if (!isImg || name === DB_FILE_NAME) continue; // lewati non-gambar
    var created = f.getDateCreated();
    records.push({
      id: fid,
      date: dateFromName_(name) ||
            Utilities.formatDate(created, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      shift: shiftFromName_(name),
      author: '',
      note: name,
      fileId: fid,
      ts: created.toISOString(),
      imported: true
    });
    added = true;
  }
  if (added) writeAllRecords_(records);
}

/* Coba tebak tanggal dari nama file (2026-08-21 atau 21-08-2026) */
function dateFromName_(name) {
  var m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = name.match(/(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/* Coba tebak shift dari nama file (Red / White) */
function shiftFromName_(name) {
  var n = name.toLowerCase();
  if (/(^|[^a-z])red([^a-z]|$)/.test(n)) return 'Red';
  if (/(^|[^a-z])(white|putih)([^a-z]|$)/.test(n)) return 'White';
  return '';
}

/* ── Ambil form PDF dari Drive (untuk di-corat) ── */
var FORM_PDF_NAME = 'info-antar-shift.pdf';

function getFormPdf_(fileId) {
  try {
    var file = null;
    if (fileId) {
      file = DriveApp.getFileById(fileId);
    }
    if (!file) {
      var it = DriveApp.getFilesByName(FORM_PDF_NAME);
      file = it.hasNext() ? it.next() : null;
    }
    if (!file) {
      // cek juga di dalam folder laporan
      var it2 = getFolder_().getFilesByName(FORM_PDF_NAME);
      file = it2.hasNext() ? it2.next() : null;
    }
    if (!file) {
      return { ok: false, error: 'Form PDF tidak ditemukan di Drive. Atur File ID di Pengaturan atau upload file bernama ' + FORM_PDF_NAME + '.' };
    }
    var bytes = file.getBlob().getBytes();
    var b64 = Utilities.base64Encode(bytes);
    return { ok: true, b64: b64, size: bytes.length };
  } catch (e) {
    return { ok: false, error: 'Gagal membaca PDF: ' + e.message };
  }
}

/* ══════════════════════════════════════════════════════════════
   KEEP-WARM (percepat akses pertama / test exec)
   Cold start Google Apps Script membuat request pertama setelah
   idle lama terasa lambat (10-40 detik). Trigger berkala ini
   memanggil deployment /exec sendiri tiap 10 menit sehingga
   instance Web App tetap "hangat".
   Aktifkan sekali: jalankan ensureWarmTrigger() di editor Apps
   Script (izin UrlFetchApp akan diminta); trigger berjalan
   memanggil fungsi keepWarm_() dengan rute ?app=ping.
   ══════════════════════════════════════════════════════════════ */

function keepWarm_() {
  try {
    var u = ScriptApp.getService().getUrl();
    if (!u) return;
    // 2 percobaan supaya tahan terhadap sekali gagal/429.
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        UrlFetchApp.fetch(u + '?app=ping&warm=1', { muteHttpExceptions: true });
        return;
      } catch (e) {}
      Utilities.sleep(500);
    }
  } catch (e) {}
}

function ensureWarmTrigger() {
  var trigs = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trigs.length; i++) {
    if (trigs[i].getHandlerFunction() === 'keepWarm_') return trigs[i].getUniqueId();
  }
  var trig = ScriptApp.newTrigger('keepWarm_').timeBased().everyMinutes(10).create();
  return trig.getUniqueId();
}

function output_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}