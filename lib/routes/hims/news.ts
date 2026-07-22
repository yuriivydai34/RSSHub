import { fetchQ4News } from '@/routes/q4/utils';
import type { Route } from '@/types';

const DOMAIN = 'investors.hims.com';

export const route: Route = {
    path: '/news',
    categories: ['finance'],
    example: '/hims/news',
    parameters: {
        limit: {
            description: 'Number of items to return. Each uncached item takes a couple seconds to fetch (Cloudflare throttling), so large values are slow',
            default: '10',
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['investors.hims.com/news/default.aspx', 'investors.hims.com/'],
            target: '/news',
        },
    ],
    name: 'Investor News',
    maintainers: ['yuriivydai34'],
    handler,
};

async function handler(ctx) {
    const limit = ctx.req.query('limit') ? Number(ctx.req.query('limit')) : 10;

    const feed = await fetchQ4News(DOMAIN, limit);
    return { ...feed, title: 'Hims & Hers - Investor News' };
}
