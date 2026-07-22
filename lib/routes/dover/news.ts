import { load } from 'cheerio';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const NEWS_URL = 'https://www.dovercorporation.com/news';

export const route: Route = {
    path: '/news',
    categories: ['finance'],
    example: '/dover/news',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'News',
    maintainers: ['yuriivydai34'],
    handler,
};

// Dover's news list is a Sitefinity CMS "News" module (li.sfnewsListItem), server-rendered
// with title, link, and date already in the static HTML — plain cheerio, no JSON blob needed.
async function handler() {
    const html = await ofetch(NEWS_URL);
    const $ = load(html);

    const item = $('li.sfnewsListItem')
        .toArray()
        .map((el) => {
            const $el = $(el);
            const $link = $el.find('h2.sfnewsTitle a').first();
            const href = $link.attr('href');
            const dateText = $el.find('.sfnewsMetaInfo').contents().first().text().trim();

            return {
                title: $link.text().trim(),
                link: href ? new URL(href, NEWS_URL).href : '',
                pubDate: parseDate(dateText),
            };
        })
        .filter((i) => i.title && i.link);

    return {
        title: 'Dover Corporation News',
        link: NEWS_URL,
        item,
    };
}
