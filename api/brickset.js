// api/brickset.js
// Server-side proxy for Brickset's API: keeps BRICKSET_API_KEY out of the
// browser and returns the LEGO.com US retail price, availability, and
// launch/retirement dates for one set.
//
// Browser usage: /api/brickset?setNumber=10305-1

// Requests must come from the site itself, so other websites can't use this
// function (and your Brickset quota) through their visitors' browsers.
// A deterrent, not a lock — a script can fake these headers.
const ALLOWED_ORIGINS = ['https://www.90sgeek.org', 'https://90sgeek.org'];

function fromOwnSite(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true;
  const origin  = req.headers.origin || '';
  const referer = req.headers.referer || '';
  return ALLOWED_ORIGINS.includes(origin) ||
         ALLOWED_ORIGINS.some(o => referer === o || referer.startsWith(o + '/'));
}

// LEGO set numbers: digits/letters, optional "-variant" (e.g. 10305-1, COMCON001-1)
const SET_NUMBER = /^[A-Za-z0-9]{1,20}(-\d{1,3})?$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!fromOwnSite(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { setNumber } = req.query;
  if (typeof setNumber !== 'string' || !SET_NUMBER.test(setNumber)) {
    return res.status(400).json({ error: 'Invalid setNumber' });
  }

  const apiKey = process.env.BRICKSET_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'BRICKSET_API_KEY not configured' });

  const params = encodeURIComponent(JSON.stringify({ setNumber, pageSize: 1 }));
  const url = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(apiKey)}&userHash=&params=${params}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`Brickset returned ${upstream.status}`);
    const data = await upstream.json();
    if (data.status && data.status !== 'success') throw new Error('Brickset error');

    const set = data.sets?.[0];
    const us  = set?.LEGOCom?.US || {};
    const day = v => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    };
    // Retail prices and dates rarely change: let Vercel's CDN reuse the answer
    // for a day (stale for up to a week while refreshing) so repeat lookups
    // don't hit Brickset at all.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
    return res.json({ result: {
      found:        !!set,
      retailPrice:  us.retailPrice ?? null,
      availability: set?.availability ?? null,
      // Brickset's own launch/exit dates first; fall back to when the set
      // appeared on / disappeared from LEGO.com US.
      launchDate:   day(set?.launchDate) ?? day(us.dateFirstAvailable),
      exitDate:     day(set?.exitDate)   ?? day(us.dateLastAvailable),
    } });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Could not reach Brickset' });
  }
}
