/*
 * Proxy server-side untuk data Dashboard Finishing (QC Gate).
 * Halaman statis tidak bisa fetch langsung ke qc-gate-production.vercel.app
 * karena API-nya tidak mengirim header CORS. Fungsi ini mengambil data dari
 * server Vercel lalu mengembalikannya ke origin yang sama.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 8000);

  try {
    const [stateRes, linesRes] = await Promise.all([
      fetch('https://qc-gate-production.vercel.app/api/state', {
        signal: controller.signal,
        cache: 'no-store'
      }),
      fetch('https://qc-gate-production.vercel.app/api/defect-lines', {
        signal: controller.signal,
        cache: 'no-store'
      })
    ]);

    const [stateJson, linesJson] = await Promise.all([
      stateRes.json(),
      linesRes.json()
    ]);

    if (!stateRes.ok || !stateJson || !stateJson.success) {
      throw new Error((stateJson && stateJson.error) || 'Gagal mengambil state QC');
    }
    if (!linesRes.ok || !linesJson || !linesJson.success) {
      throw new Error((linesJson && linesJson.error) || 'Gagal mengambil master defect');
    }

    res.status(200).json({
      success: true,
      state: stateJson.data,
      mappings: linesJson.data
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: (err && err.message) ? err.message : 'Gagal mengambil data Dashboard Finishing'
    });
  } finally {
    clearTimeout(timer);
  }
};
