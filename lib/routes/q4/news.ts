import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Route } from '@/types';

import { fetchQ4News } from './utils';

export const route: Route = {
    path: '/news/:domain',
    categories: ['finance'],
    example: '/q4/news/investors.hims.com',
    parameters: {
        domain: 'Hostname of a Q4 Inc.-hosted investor relations site, e.g. `investors.hims.com`',
        limit: {
            description: 'Number of items to return. Each uncached item takes a couple seconds to fetch (Cloudflare throttling), so large values are slow',
            default: '10',
        },
    },
    features: {
        requireConfig: [
            {
                name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN',
                description: 'Since `domain` is user-supplied, this route is disabled unless the instance owner opts in.',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Investor News (Q4 Inc. IR platform, any domain)',
    maintainers: ['yuriivydai34'],
    handler,
};

function handler(ctx) {
    if (!config.feature.allow_user_supply_unsafe_domain) {
        throw new ConfigNotFoundError(`This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.`);
    }

    const domain = ctx.req.param('domain');
    const limit = ctx.req.query('limit') ? Number(ctx.req.query('limit')) : 10;

    return fetchQ4News(domain, limit);
}
