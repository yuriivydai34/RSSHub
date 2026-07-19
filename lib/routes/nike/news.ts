import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const URL = 'https://about.nike.com/en/newsroom';

interface NewsroomItem {
    title: string;
    slug: string;
    date_label: string;
}

export const route: Route = {
    path: '/news',
    categories: ['other'],
    example: '/nike/news',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Newsroom',
    maintainers: ['yuriivydai34'],
    handler,
};

// The newsroom landing page is server-rendered by Next.js with the full item list
// (title, slug, date) embedded as JSON in a __NEXT_DATA__ script tag, so no HTML
// scraping or headless browser is needed — just parse that blob directly.
async function handler() {
    const html = await ofetch(URL);
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) {
        throw new Error('__NEXT_DATA__ not found on Nike newsroom page');
    }

    const data = JSON.parse(match[1]);
    const pageData = data.props.pageProps.data;
    const items: NewsroomItem[] = [pageData.featured_newsroom_item, ...(pageData.blocks?.[0]?.newsroom_landing_items ?? [])].filter(Boolean);

    return {
        title: 'NIKE, Inc. Newsroom',
        link: URL,
        item: items.map((item) => ({
            title: item.title,
            link: `https://about.nike.com/en/newsroom/releases/${item.slug}`,
            pubDate: parseDate(item.date_label),
        })),
    };
}
