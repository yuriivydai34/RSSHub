import https from 'node:https';
import zlib from 'node:zlib';

import { load } from 'cheerio';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    // RSSHub's cache middleware keys purely on path + limit (see lib/middleware/cache.ts) and
    // ignores query params entirely, so a ?url= query param here would make every sitemap on
    // this instance share one cache entry. Base64url-encoding the target URL into the path
    // itself (same trick other arbitrary-URL routes use) gives each target its own cache key.
    path: '/parse/:encodedUrl',
    categories: ['finance'],
    example: '/sitemap-news/parse/aHR0cHM6Ly93d3cuYWJidmllLmNvbS9zaXRlbWFwLnhtbA',
    parameters: {
        encodedUrl: 'Base64url (no padding) of the full sitemap.xml URL — NOT the Google News Sitemap extension, see /news-sitemap for that',
        limit: {
            description: 'Number of items to return. Each uncached item takes a page fetch to get its title, so large values are slow',
            default: '15',
        },
    },
    features: {
        requireConfig: [
            {
                name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN',
                description: 'Since `url` is user-supplied, this route is disabled unless the instance owner opts in.',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'News/Press URLs from a plain sitemap (any domain)',
    maintainers: ['yuriivydai34'],
    handler,
};

// Most corporate sitemaps don't carry article titles (unlike the Google News Sitemap
// extension, see ../news-sitemap) and are frequently a top-level index of per-section
// sitemap files rather than a flat list of pages. So: fetch the root sitemap, if it looks
// like an index (most <loc> end in .xml) drill into the sub-sitemap(s) whose URL matches a
// news/press keyword, then from the resulting page URLs keep only ones that look like an
// actual news/press-release detail page, and fetch each for a real <title>/og:title.
const NEWS_SECTION_RE = /news|press|media-center|announcements/i;
// Article URLs are often nested under the section (/press-release/2022/slug, not just
// /press-release/slug), so only require the exact section segment followed by more path —
// no end anchor, so multi-segment tails (date, id, slug...) all still match.
const NEWS_DETAIL_RE = /\/(?:news|press|press-releases?|newsroom|media|announcements)\/[^/?#]/i;
const MAX_SUB_SITEMAPS = 12;
const CONCURRENCY = 3;

// Many corporate sites fingerprint undici (the fetch implementation behind ofetch/got) and
// block it even while serving plain curl/browser requests fine — same issue documented in
// ../q4/utils.ts. Node's classic https module dodges that fingerprint, so use it here too.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Node's classic https module (unlike fetch/ofetch/curl) does NOT auto-decompress the
// response body, so a server that gzips its sitemap (common — they're large) hands back
// raw compressed bytes here; decode by Content-Encoding before treating it as text.
function fetchHtml(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' } }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Request failed with status ${res.statusCode}`));
                    return;
                }

                const encoding = res.headers['content-encoding'];
                let stream: NodeJS.ReadableStream = res;
                switch (encoding) {
                    case 'gzip': {
                        stream = res.pipe(zlib.createGunzip());

                        break;
                    }
                    case 'br': {
                        stream = res.pipe(zlib.createBrotliDecompress());

                        break;
                    }
                    case 'deflate': {
                        stream = res.pipe(zlib.createInflate());

                        break;
                    }
                    default:
                    // Do nothing
                }

                const chunks: Buffer[] = [];
                stream.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                stream.on('error', reject);
            })
            .on('error', reject);
    });
}

interface SitemapEntry {
    loc: string;
    lastmod: Date | null;
}

async function fetchSitemapEntries(url: string): Promise<SitemapEntry[]> {
    const xml = await fetchHtml(url);
    const $ = load(xml, { xmlMode: true });

    return $('url')
        .toArray()
        .map((el) => {
            const $el = $(el);
            const lastmodText = $el.find('lastmod').first().text().trim();
            return {
                loc: $el.find('loc').first().text().trim(),
                lastmod: lastmodText ? parseDate(lastmodText) : null,
            };
        })
        .filter((e) => e.loc);
}

function titleFromSlug(link: string) {
    const segments = new URL(link).pathname.split('/').filter(Boolean);
    const slug = segments.at(-1) ?? '';
    return slug.replaceAll(/[-_]/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let cursor = 0;
    async function next() {
        while (cursor < items.length) {
            const index = cursor++;
            // eslint-disable-next-line no-await-in-loop
            await worker(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

// cache.tryGet round-trips cached values through JSON, so a Date we stored earlier comes
// back as a plain string on a cache hit (only on a fresh fetch is it still a Date) — parse
// through `new Date(...)` unconditionally instead of assuming `.getTime` exists.
const toTime = (d: unknown) => (d ? new Date(d as string | number | Date).getTime() : 0);

async function handler(ctx) {
    if (!config.feature.allow_user_supply_unsafe_domain) {
        throw new ConfigNotFoundError(`This route is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`);
    }

    const encodedUrl = ctx.req.param('encodedUrl');
    if (!encodedUrl) {
        throw new Error('Missing required "encodedUrl" path parameter');
    }
    const sitemapUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');
    const limit = ctx.req.query('limit') ? Number(ctx.req.query('limit')) : 15;

    let entries = await fetchSitemapEntries(sitemapUrl);

    const xmlCount = entries.filter((e) => e.loc.endsWith('.xml')).length;
    const looksLikeIndex = entries.length > 0 && xmlCount / entries.length > 0.5;

    if (looksLikeIndex) {
        // Prefer sub-sitemaps whose own URL hints at news/press (cheaper, usually right first
        // try), but companies file news under all sorts of section names ("company", "about",
        // "media-center-that-doesn't-match"...), so fall back to the rest too rather than
        // giving up — the final NEWS_DETAIL_RE filter on actual page URLs is what really
        // decides relevance, this ordering just tries the likely-relevant ones first.
        const bySectionMatch = [...entries].toSorted((a, b) => Number(NEWS_SECTION_RE.test(b.loc)) - Number(NEWS_SECTION_RE.test(a.loc)));
        const subSitemaps = bySectionMatch.slice(0, MAX_SUB_SITEMAPS);
        const results = await Promise.allSettled(subSitemaps.map((sub) => fetchSitemapEntries(sub.loc)));
        entries = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    }

    const candidates = entries
        .filter((e) => NEWS_DETAIL_RE.test(e.loc))
        .toSorted((a, b) => (b.lastmod?.getTime() ?? 0) - (a.lastmod?.getTime() ?? 0))
        .slice(0, limit);

    const item: Array<{ title: string; link: string; pubDate?: Date }> = [];
    await runWithConcurrency(candidates, CONCURRENCY, async (entry) => {
        const result = await cache.tryGet(entry.loc, async () => {
            const fallback = { title: titleFromSlug(entry.loc), link: entry.loc, pubDate: entry.lastmod ?? undefined };
            try {
                const html = await fetchHtml(entry.loc);
                const $$ = load(html);
                const title = $$('meta[property="og:title"]').attr('content') || $$('title').first().text().trim();
                return title ? { ...fallback, title } : fallback;
            } catch {
                return fallback;
            }
        });
        item.push(result as { title: string; link: string; pubDate?: Date });
    });

    return {
        title: `${new URL(sitemapUrl).hostname} - News Sitemap`,
        link: sitemapUrl,
        item: item.toSorted((a, b) => toTime(b.pubDate) - toTime(a.pubDate)),
    };
}
