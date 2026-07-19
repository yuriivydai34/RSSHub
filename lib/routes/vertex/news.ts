import { load } from 'cheerio';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const NEWS_URL = 'https://news.vrtx.com/press-releases';

export const route: Route = {
    path: '/news',
    categories: ['finance'],
    example: '/vertex/news',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Press Releases',
    maintainers: ['yuriivydai34'],
    handler,
};

// news.vrtx.com runs on a Notified/Intrado ("nir-widget") IR platform. Its press-release
// table is server-rendered with title, link, and date already in the static HTML.
async function handler() {
    const html = await ofetch(NEWS_URL);
    const $ = load(html);

    const item = $('.nir-widget--news--headline')
        .toArray()
        .map((el) => {
            const $el = $(el);
            const $link = $el.find('a[href]').last();
            const href = $link.attr('href');
            const dateText = $el.closest('tr').find('.nir-widget--news--date-time').first().text().trim();

            return {
                title: $link.text().trim(),
                link: href ? new URL(href, NEWS_URL).href : '',
                pubDate: parseDate(dateText),
            };
        })
        .filter((i) => i.title && i.link);

    return {
        title: 'Vertex Pharmaceuticals Press Releases',
        link: NEWS_URL,
        item,
    };
}
