import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const PAGE_URL = 'https://www.jpmorganchase.com/newsroom/press-releases';
const SERVICE_BASE = 'https://www.jpmorganchase.com/services/json/v1/dynamic-grid.service/';

interface DynamicGridItem {
    title: string;
    date: string;
    description?: string;
    link: string;
}

export const route: Route = {
    path: '/news',
    categories: ['finance'],
    example: '/jpmorganchase/news',
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

// The press-release list is an AEM "Dynamic Grid" component, fetched by the browser
// client-side. The page embeds the exact API call as a data-dg-action="{...}" JSON
// attribute (path/parent/comp/page), so we can build the same request directly —
// no headless browser needed.
async function handler() {
    const html = await ofetch(PAGE_URL);
    const match = html.match(/data-dg-action="([^"]+)"/);
    if (!match) {
        throw new Error('data-dg-action not found on JPMorganChase press releases page');
    }

    const action = JSON.parse(match[1].replaceAll('&#34;', '"').replaceAll('&quot;', '"'));
    const serviceUrl = `${SERVICE_BASE}parent=${action.parent}&comp=${action.comp}&page=${action.page}.json`;

    const data = await ofetch(serviceUrl);
    const items: DynamicGridItem[] = data.items ?? [];

    return {
        title: 'JPMorganChase Press Releases',
        link: PAGE_URL,
        item: items.map((item) => ({
            title: item.title,
            description: item.description,
            link: new URL(item.link, PAGE_URL).href,
            pubDate: parseDate(item.date),
        })),
    };
}
