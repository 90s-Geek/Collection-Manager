// api/_auth.js
// Shared login check for the serverless proxies. Files starting with "_"
// are not exposed as routes by Vercel, so this is a helper only.
//
// The browser sends its Supabase access token in the X-Auth-Token header
// (see the fetch wrapper in core.js). We ask Supabase who that token
// belongs to; no valid session → 401. This replaces the old Origin/Referer
// check as the real lock, since those headers are easy to fake.
//
// A custom header is used instead of Authorization on purpose: Vercel's CDN
// won't cache requests that carry Authorization, and the proxies rely on
// that cache to stay under the Rebrickable/Brickset rate limits. Cached
// responses are public LEGO catalog data and don't use any API quota.

// Both values are public (they already ship in the site's pages).
// Override with Vercel env vars if the project ever changes.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sgmibyooymrocvojchxu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnbWlieW9veW1yb2N2b2pjaHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzk0OTYsImV4cCI6MjA4NzExNTQ5Nn0.nLXsVr6mvsCQJijHsO2wkw49e0J4JZ-2oiLTpKZGmu0';

// Optional: set ALLOWED_EMAIL in Vercel to accept only your own account
// (comma-separate for more than one). Unset = any signed-in user.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAIL || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Warm function instances remember tokens they've already checked for a
// few minutes, so a burst of lookups costs one Supabase round-trip.
const verified = new Map(); // token -> expiry (ms)
const CACHE_MS = 5 * 60 * 1000;

export async function requireUser(req, res) {
  const token = req.headers['x-auth-token'];
  if (typeof token !== 'string' || token.length < 20) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: 'Sign in required' });
    return false;
  }

  const hit = verified.get(token);
  if (hit && hit > Date.now()) return true;

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (r.ok) {
      const user = await r.json();
      const email = String(user?.email || '').toLowerCase();
      if (!ALLOWED_EMAILS.length || ALLOWED_EMAILS.includes(email)) {
        if (verified.size > 200) verified.clear();
        verified.set(token, Date.now() + CACHE_MS);
        return true;
      }
    }
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Could not verify sign-in' });
    return false;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({ error: 'Sign in required' });
  return false;
}
