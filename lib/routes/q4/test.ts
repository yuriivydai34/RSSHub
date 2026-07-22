import type { Route } from '@/types';

import { fetchQ4News } from './utils';

// Local-only testing twin of /q4/news/:domain, without the ALLOW_USER_SUPPLY_UNSAFE_DOMAIN
// gate, so we can try many Q4-hosted IR domains against a locally running dev instance
// without restarting it with that flag enabled. Not meant to be pushed upstream.
export const route: Route = {
    path: '/test/:domain',
    categories: ['finance'],
    example: '/q4/test/investors.hims.com',
    parameters: {
        domain: 'Hostname of a Q4 Inc.-hosted investor relations site, e.g. `investors.hims.com`',
        limit: {
            description: 'Number of items to return',
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
    name: 'Investor News (Q4 Inc. IR platform, any domain) [local test]',
    maintainers: ['yuriivydai34'],
    handler,
};

function handler(ctx) {
    const domain = ctx.req.param('domain');
    const limit = ctx.req.query('limit') ? Number(ctx.req.query('limit')) : 10;

    return fetchQ4News(domain, limit);
}
