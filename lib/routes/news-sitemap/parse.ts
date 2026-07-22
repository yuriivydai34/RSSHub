import { load } from 'cheerio';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    // RSSHub's cache middleware keys purely on path + limit (see lib/middleware/cache.ts) and
    // ignores query params entirely, so a ?url= query param here made every sitemap on this
    // instance (AIG, AMCR, ...) share ONE cache entry — whichever was fetched first "won" and
    // got served to all of them. Base64url-encoding the target URL into the path itself gives
    // each target its own cache key, same trick as ../sitemap-news.
    path: '/parse/:encodedUrl',
    categories: ['finance'],
    example: '/news-sitemap/parse/aHR0cHM6Ly93d3cuYWlnLmNvbS9uZXdzLXNpdGVtYXAueG1s',
    parameters: {
        encodedUrl: 'Base64url (no padding) of the full sitemap URL, using the Google News Sitemap extension (xmlns:news, per sitemaps.org)',
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
    name: 'Google News Sitemap (any URL)',
    maintainers: ['yuriivydai34'],
    handler,
};

// Companies often publish a Google News Sitemap (the xmlns:news extension defined by
// sitemaps.org) for their newsroom/stories pages, even when they aren't a news publisher —
// it's an SEO convention, not a proprietary IR platform, so this one parser works for any
// site that has one, unlike the Q4/Sitefinity/nir-widget routes which only work for a
// specific vendor's customers.
async function handler(ctx) {
    if (!config.feature.allow_user_supply_unsafe_domain) {
        throw new ConfigNotFoundError(`This route is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`);
    }

    const encodedUrl = ctx.req.param('encodedUrl');
    if (!encodedUrl) {
        throw new Error('Missing required "encodedUrl" path parameter');
    }
    const sitemapUrl = Buffer.from(encodedUrl, 'base64url').toString('utf8');

    const xml = await ofetch(sitemapUrl);
    const $ = load(xml, { xmlMode: true });

    const item = $('url')
        .toArray()
        .map((el) => {
            const $el = $(el);
            return {
                title: $el
                    .find(String.raw`news\:title`)
                    .text()
                    .trim(),
                link: $el.find('loc').first().text().trim(),
                pubDate: parseDate(
                    $el
                        .find(String.raw`news\:publication_date`)
                        .text()
                        .trim()
                ),
            };
        })
        .filter((i) => i.title && i.link)
        .toSorted((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

    return {
        title: `News Sitemap - ${new URL(sitemapUrl).hostname}`,
        link: sitemapUrl,
        item,
    };
}
