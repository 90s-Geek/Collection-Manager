// api/brickset.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { setNumber } = req.query;
  if (!setNumber) return res.status(400).json({ error: 'setNumber is required' });

  const apiKey = process.env.BRICKSET_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'BRICKSET_API_KEY not configured' });

  const url = `https://brickset.com/api/v3.asmx/getSets?apiKey=${apiKey}&userHash=&params=${encodeURIComponent(JSON.stringify({ setNumber, pageSize: 1 }))}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`Brickset returned ${upstream.status}`);
    const data = await upstream.json();
    const set = data.sets?.[0];
    res.json({ result: { retailPrice: set?.LEGOCom?.US?.retailPrice ?? null } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
