// api/news.js
// Fetches LEGO news from a few public RSS feeds, merges them, and returns
// clean JSON. Each source is fetched independently — if one feed is down
// or has moved, the others still come through.

const FEEDS = [
  { source: 'Brickset', url: 'https://brickset.com/feed/' },
  { source: 'Brick Fanatics', url: 'https://www.brickfanatics.com/feed/' },
  { source: 'The Brothers Brick', url: 'https://feeds.feedburner.com/TheBrothersBrick' },
];

// Recurring Brickset filler posts that aren't really "news"
const TITLE_EXCLUDE = [
  /^random (set|figure) of the day/i,
  /^what'?s hot this week/i,
  /^this week'?s top news articles/i,
  /^recent reviews$/i,
  /^vintage set of the week/i,
];

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function extractImage(block) {
  // Try <media:content>, <enclosure>, or first <img src="..."> in description
  const media = block.match(/<media:content[^>]+url=["']([^"']+)["']/i)
    || block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i)
    || block.match(/<img[^>]+src=["']([^"']+)["']/i);
  return media ? media[1] : null;
}

function parseFeed(xml, source) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(block => {
    const title = decodeEntities(extractTag(block, 'title'));
    const link = extractTag(block, 'link') || extractTag(block, 'guid');
    const pubDateRaw = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
    const description = extractTag(block, 'description') || extractTag(block, 'content:encoded');
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
    return {
      title,
      link: link.trim(),
      source,
      pubDate: pubDate && !isNaN(pubDate) ? pubDate.toISOString() : null,
      image: extractImage(block),
      excerpt: stripTags(description).slice(0, 160),
    };
  }).filter(item =>
    item.title && item.link && !TITLE_EXCLUDE.some(re => re.test(item.title))
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = await Promise.allSettled(
    FEEDS.map(async ({ source, url }) => {
      const upstream = await fetch(url, { headers: { 'User-Agent': '90sGeekLegoApp/1.0' } });
      if (!upstream.ok) throw new Error(`${source} returned ${upstream.status}`);
      const xml = await upstream.text();
      return parseFeed(xml, source);
    })
  );

  const articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  const failedSources = results
    .map((r, i) => (r.status === 'rejected' ? FEEDS[i].source : null))
    .filter(Boolean);

  if (!articles.length) {
    return res.status(502).json({ error: 'All news sources failed', failedSources });
  }

  res.json({ articles: articles.slice(0, 40), failedSources });
}
