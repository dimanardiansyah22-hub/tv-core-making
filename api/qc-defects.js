/*
 * Data trend defect Core Making untuk halaman News & Defect Chart.
 *
 * Sumber: Dashboard Finishing (QC Gate)
 *   /api/state        -> data shift berjalan (hari ini)
 *   /api/history      -> riwayat shift yang sudah tersimpan
 *   /api/defect-lines -> master defect per line (untuk tahu mana defect Core Making)
 *
 * Hanya defect yang termasuk line "Core Making" yang dikirim ke client.
 * Nama defect dari lapangan bisa punya akhiran (mis. "Gomi Cope", "Gas Hole
 * Cope"), jadi dicocokkan ke nama kanonis dari master defect.
 */

const QC_BASE = 'https://qc-gate-production.vercel.app';
const FALLBACK_CORE = ['Gas Hole', 'Gomi', 'Gyakubari', 'Mejashi', 'Togata Tare', 'Vinning'];
const WINDOW_DAYS = 14;

function normName(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase().replace(/\s+/g, '');
}

/* Geser tanggal YYYY-MM-DD sebanyak delta hari (aman terhadap zona waktu). */
function shiftDate(date, delta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return '';
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + delta * 86400000;
  const d = new Date(t);
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

/* Cocokkan nama defect lapangan ke nama kanonis Core Making.
   Dipilih nama kanonis terpanjang yang cocok agar tidak salah kelompok. */
function pickCore(name, coreNames) {
  const a = normName(name);
  if (!a) return null;
  let best = null;
  let bestLen = 0;
  for (let i = 0; i < coreNames.length; i++) {
    const c = coreNames[i];
    const b = normName(c);
    if (!b) continue;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
      if (b.length > bestLen) { best = c; bestLen = b.length; }
    }
  }
  return best;
}

function isCoreLine(line) {
  return normName(line) === 'coremaking';
}

function dayKey(date) {
  return String(date || '').slice(0, 10);
}

function addCounts(day, data, coreNames, mode) {
  if (!data || typeof data !== 'object') return;
  Object.keys(data).forEach(function (name) {
    const n = Math.max(0, Number(data[name]) || 0);
    if (!n) return;
    const canon = pickCore(name, coreNames);
    if (!canon) return;
    const prev = Number(day.defects[canon]) || 0;
    day.defects[canon] = mode === 'max' ? Math.max(prev, n) : (prev + n);
  });
}

function finalizeDay(day) {
  let total = 0;
  Object.keys(day.defects).forEach(function (k) { total += day.defects[k]; });
  day.total = total;
  return day;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 10000);

  function getJson(path) {
    return fetch(QC_BASE + path, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j || !j.success) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j.data;
      });
    });
  }

  try {
    const results = await Promise.allSettled([
      getJson('/api/state'),
      getJson('/api/defect-lines'),
      getJson('/api/history')
    ]);

    const state = results[0].status === 'fulfilled' ? results[0].value : null;
    const mappings = results[1].status === 'fulfilled' ? results[1].value : null;
    const history = results[2].status === 'fulfilled' ? results[2].value : null;

    if (!state && !(history && history.length)) {
      const err = (results[0].status === 'rejected' && results[0].reason && results[0].reason.message)
        || (results[2].status === 'rejected' && results[2].reason && results[2].reason.message)
        || 'Gagal mengambil data Dashboard Finishing';
      throw new Error(err);
    }

    /* Daftar defect Core Making dari master; fallback bila master gagal. */
    let coreNames = [];
    if (Array.isArray(mappings)) {
      coreNames = mappings.filter(function (m) {
        return m && isCoreLine(m.line) && m.defectName;
      }).map(function (m) { return String(m.defectName); });
    }
    if (!coreNames.length) coreNames = FALLBACK_CORE.slice();

    const days = {};
    const seenShift = {};

    function ensureDay(date) {
      const d = dayKey(date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
      return days[d] || (days[d] = { date: d, defects: {}, total: 0 });
    }

    (Array.isArray(history) ? history : []).forEach(function (rec) {
      const day = ensureDay(rec && rec.date);
      if (!day) return;
      const key = day.date + '|' + String(rec.shift || '') + '|' + String(rec.shiftTime || '');
      if (seenShift[key]) {
        /* Shift yang sama muncul lebih dari sekali: jangan dijumlahkan. */
        addCounts(day, rec.defectData, coreNames, 'max');
        return;
      }
      seenShift[key] = true;
      addCounts(day, rec.defectData, coreNames, 'sum');
    });

    /* Data shift berjalan (hari ini). Bila shift yang sama sudah ada di
       riwayat, pakai MAX agar tidak dobel; bila shift berbeda, jumlahkan. */
    if (state && state.date) {
      const day = ensureDay(state.date);
      if (day) {
        const key = day.date + '|' + String(state.shift || '') + '|' + String(state.shiftTime || '');
        addCounts(day, state.defectData, coreNames, seenShift[key] ? 'max' : 'sum');
      }
    }

    /* Endpoint /api/history hanya mengembalikan 10 record terakhir, jadi
       tanggal yang belum tercakup diambil satu per satu dengan ?date=.
       Tujuannya agar chart selalu punya jendela 14 hari yang utuh. */
    const known = Object.keys(days).sort();
    const anchor = known.length ? known[known.length - 1] : null;
    let list = [];

    if (anchor) {
      const windowDates = [];
      for (let i = WINDOW_DAYS - 1; i >= 0; i--) windowDates.push(shiftDate(anchor, -i));

      const missing = windowDates.filter(function (d) { return !days[d]; });
      if (missing.length) {
        const fetched = await Promise.allSettled(missing.map(function (d) {
          return getJson('/api/history?date=' + encodeURIComponent(d));
        }));
        fetched.forEach(function (r, i) {
          if (r.status !== 'fulfilled' || !Array.isArray(r.value) || !r.value.length) return;
          const day = ensureDay(missing[i]);
          if (!day) return;
          r.value.forEach(function (rec) { addCounts(day, rec.defectData, coreNames, 'sum'); });
        });
      }

      list = windowDates.map(function (d) { return finalizeDay(ensureDay(d)); });
    }

    /* Urutkan defect berdasarkan total selama periode (paling besar dulu),
       dan hanya kirim yang pernah muncul. */
    const totals = {};
    list.forEach(function (day) {
      Object.keys(day.defects).forEach(function (name) {
        totals[name] = (totals[name] || 0) + day.defects[name];
      });
    });
    const defects = Object.keys(totals).sort(function (a, b) {
      if (totals[b] !== totals[a]) return totals[b] - totals[a];
      return a.localeCompare(b);
    });

    res.status(200).json({
      success: true,
      source: 'Dashboard Finishing',
      today: state && state.date ? dayKey(state.date) : null,
      updatedAt: new Date().toISOString(),
      defects: defects,
      totals: totals,
      windowDays: WINDOW_DAYS,
      days: list
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: (err && err.message) ? err.message : 'Gagal mengambil data defect'
    });
  } finally {
    clearTimeout(timer);
  }
};
