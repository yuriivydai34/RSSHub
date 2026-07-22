import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const URL = 'https://www.take2games.com/';

interface NewsItem {
    title: string;
    slug: string;
    releaseDate: string;
    externalLink: string | null;
}

export const route: Route = {
    path: '/news',
    categories: ['finance'],
    example: '/take-two/news',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Investor News',
    maintainers: ['yuriivydai34'],
    handler,
};

// The homepage is server-rendered by Next.js (Contentful-backed) with a
// newsArticlesCollection block embedding the full IR news list (title, slug,
// releaseDate, externalLink) as JSON in a __NEXT_DATA__ script tag.
async function handler() {
    const html = await ofetch(URL);
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('__NEXT_DATA__ not found on Take-Two homepage');
    }

    const data = JSON.parse(match[1]);
    const items: NewsItem[] = data.props.pageProps.page.layoutCollection.items[0].newsArticlesCollection.items;

    return {
        title: 'Take-Two Interactive Investor News',
        link: 'https://www.take2games.com/ir/news',
        item: items.map((item) => ({
            title: item.title,
            link: item.externalLink ?? `https://www.take2games.com/ir/news/${item.slug}`,
            pubDate: parseDate(item.releaseDate),
        })),
    };
}
