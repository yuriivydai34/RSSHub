import https from 'node:https';

import { load } from 'cheerio';

import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

// The Q4 Inc. IR platform fronts both the news list page and individual
// article pages with a Cloudflare challenge. It only fingerprints undici
// (the fetch implementation behind ofetch/got), not Node's classic https
// module, so article pages are fetched with that instead. Even so, it
// unpredictably serves a short stand-in page (still HTTP 200, but without
// the og: meta tags) instead of the real one, so fetches are throttled and
// retried a few times before falling back to a slug-derived title.
// The sitemap (Sitemap.ashx, a platform-wide handler, not a per-client
// customization) isn't guarded at all and stays reachable through ofetch.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FETCH_DELAY = 1500;
const MAX_ATTEMPTS = 3;

// Press release detail slugs observed across Q4 clients: news-details,
// press-release-details, press-releases-details, news-release-details,
// news-releases-details, financial-release-details. The prefix word varies
// per client, so match on the "-release(s)-details/" suffix (plus the bare
// "news-details/" form, which has no "release" in it at all).
const DETAIL_PATH_RE = /-releases?-details\/|\/news-details\//i;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchHtml(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': UA } }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Request failed with status ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => resolve(data));
            })
            .on('error', reject);
    });
}

function titleFromSlug(link: string) {
    const slug = new URL(link).pathname.split('/').at(-2) ?? '';
    return slug.replaceAll('-', ' ').replaceAll(/\s+/g, ' ').trim();
}

interface Q4NewsItem {
    title: string;
    link: string;
    pubDate: Date;
    description?: string;
    image?: string;
}

export async function fetchQ4News(domain: string, limit: number): Promise<{ title: string; link: string; item: Q4NewsItem[] }> {
    const homePage = `https://${domain}`;
    const sitemapUrl = `${homePage}/Sitemap.ashx`;

    const sitemap = await ofetch(sitemapUrl, { headers: { 'User-Agent': UA } });
    const $ = load(sitemap);

    const list = $('urlset url')
        .toArray()
        .map((e) => ({
            link: $(e).find('loc').text(),
            pubDate: parseDate($(e).find('lastmod').text()),
        }))
        .filter((e) => DETAIL_PATH_RE.test(e.link))
        .toSorted((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
        .slice(0, limit);

    const items: Q4NewsItem[] = [];
    let fetchedCount = 0;
    for (const item of list) {
        items.push(
            // Sequential on purpose: parallel requests trip Cloudflare's rate limiting.
            // eslint-disable-next-line no-await-in-loop
            await cache.tryGet(item.link, async () => {
                const fallback = {
                    title: titleFromSlug(item.link),
                    link: item.link,
                    pubDate: item.pubDate,
                };

                for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    if (fetchedCount > 0) {
                        // eslint-disable-next-line no-await-in-loop
                        await delay(FETCH_DELAY);
                    }
                    fetchedCount++;

                    try {
                        // eslint-disable-next-line no-await-in-loop
                        const detail = await fetchHtml(item.link);
                        const $$ = load(detail);
                        const ogTitle = $$('meta[property="og:title"]').attr('content');
                        if (!ogTitle) {
                            // Cloudflare served the short stand-in page; retry.
                            continue;
                        }

                        return {
                            ...fallback,
                            title: ogTitle,
                            description: $$('meta[property="og:description"]').attr('content'),
                            image: $$('meta[property="og:image"]').attr('content'),
                        };
                    } catch {
                        // network error; retry
                    }
                }

                return fallback;
            })
        );
    }

    return {
        title: `${domain} - Investor News`,
        link: `${homePage}/news/default.aspx`,
        item: items,
    };
}
