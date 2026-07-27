// api/news.js
// Fetches LEGO news from a few public RSS feeds, merges them, and returns
// clean JSON. Each source is fetched independently — if one feed is down
// or has moved, the others still come through.

const FEEDS = [
  { source: 'Brickset', url: 'https://brickset.com/feed/' },
  { source: 'Brick Fanatics', url: 'https://www.brickfanatics.com/feed/' },
  { source: 'The Brothers Brick', url: 'https://feeds.feedburner.com/TheBrothersBrick' },
  { source: "Jay's Brick Blog", url: 'https://jaysbrickblog.com/feed/' },
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
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
}

function extractImage(block, htmlSources) {
  // Try <media:content> / <media:thumbnail> / <enclosure> at the item level
  // first (real XML attributes, never entity-escaped or lazy-loaded).
  const media = block.match(/<media:content[^>]+url=["']([^"']+)["']/i)
    || block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
    || block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i);
  if (media) return media[1];

  // Fall back to an <img> inside the post HTML. Many WordPress themes/
  // plugins lazy-load images, leaving a blank placeholder in `src` and the
  // real URL in `data-src`, `data-lazy-src`, `data-original`, or `srcset`
  // — so check those before giving up.
  for (const html of htmlSources) {
    if (!html) continue;
    const imgTag = html.match(/<img[^>]*>/i);
    if (!imgTag) continue;
    const tag = imgTag[0];
    const attr = tag.match(/data-lazy-src=["']([^"']+)["']/i)
      || tag.match(/data-src=["']([^"']+)["']/i)
      || tag.match(/data-original=["']([^"']+)["']/i)
      || tag.match(/srcset=["']([^"'\s]+)/i)
      || tag.match(/src=["']([^"']+)["']/i);
    if (attr && !/^data:image\//i.test(attr[1])) return attr[1];
  }
  return null;
}

function parseFeed(xml, source) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(block => {
    const title = decodeEntities(extractTag(block, 'title'));
    const link = extractTag(block, 'link') || extractTag(block, 'guid');
    const pubDateRaw = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');

    // WordPress feeds split these two purposes across separate tags:
    // <description> is a plain-text excerpt (no image, by design), while
    // <content:encoded> holds the full post HTML, including the featured
    // image. Some other feeds (e.g. Brickset) only populate <description>
    // and put the image right in there. So: use content:encoded for image
    // lookup when present (falling back to description), and description
    // for the excerpt text (falling back to content:encoded).
    const rawDescription = extractTag(block, 'description');
    const rawContent = extractTag(block, 'content:encoded');
    const descriptionHtml = decodeEntities(rawDescription);
    const contentHtml = decodeEntities(rawContent);
    const excerptSourceHtml = descriptionHtml || contentHtml;

    const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
    return {
      title,
      link: link.trim(),
      source,
      pubDate: pubDate && !isNaN(pubDate) ? pubDate.toISOString() : null,
      image: extractImage(block, [contentHtml, descriptionHtml]),
      excerpt: stripTags(excerptSourceHtml).slice(0, 160),
    };
  }).filter(item =>
    item.title && item.link && !TITLE_EXCLUDE.some(re => re.test(item.title))
  );
}

async function fetchOgImage(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': '90sGeekLegoApp/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    // Only read enough of the page to find <head> meta tags — no need to
    // download the whole article body just for one <meta> tag.
    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      while (html.length < 60000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      reader.cancel().catch(() => {});
    } else {
      html = await res.text();
    }
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return match ? match[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, 40);

  const failedSources = results
    .map((r, i) => (r.status === 'rejected' ? FEEDS[i].source : null))
    .filter(Boolean);

  if (!articles.length) {
    return res.status(502).json({ error: 'All news sources failed', failedSources });
  }

  // For any article the feed itself didn't supply an image for, fall back
  // to fetching the article page and reading its og:image meta tag. Capped
  // to a bounded batch so a source with no feed images can't blow up
  // response time on every request.
  const missingImage = articles.filter(a => !a.image).slice(0, 15);
  if (missingImage.length) {
    await Promise.allSettled(
      missingImage.map(async (a) => {
        const img = await fetchOgImage(a.link);
        if (img) a.image = img;
      })
    );
  }

  res.json({ articles, failedSources });
}
