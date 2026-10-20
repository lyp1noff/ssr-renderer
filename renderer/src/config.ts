function positiveInteger(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return value;
}

const origin = new URL(process.env.ORIGIN_BASE_URL || '');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('ORIGIN_BASE_URL must contain only an HTTP(S) origin');
}

export const config = {
    origin,
    port: positiveInteger('PORT', 3003),
    browsers: positiveInteger('BROWSER_COUNT', 2),
    pagesPerBrowser: positiveInteger('PAGES_PER_BROWSER', 4),
    queueLimit: positiveInteger('QUEUE_LIMIT', 64),
    queueTimeout: positiveInteger('QUEUE_TIMEOUT_MS', 5000),
    renderTimeout: positiveInteger('RENDER_TIMEOUT_MS', 20000),
    browserMaxRenders: positiveInteger('BROWSER_MAX_RENDERS', 1000),
    browserMaxAge: positiveInteger('BROWSER_MAX_AGE_MS', 1800000),
    cacheTTL: positiveInteger('CACHE_TTL_SECONDS', 1800),
    checkPath: process.env.RENDER_CHECK_PATH || '/',
    allowedOrigins: new Set([origin.origin, ...(process.env.RESOURCE_ORIGINS || '').split(',').filter(Boolean).map(value => new URL(value).origin)]),
};
if (!config.checkPath.startsWith('/') || new URL(config.checkPath, origin).origin !== origin.origin) {
    throw new Error('RENDER_CHECK_PATH must be a same-origin path');
}

export class HttpError extends Error {
    constructor(public readonly status: number, message: string, options?: ErrorOptions) {super(message, options);}
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({time: new Date().toISOString(), event, ...fields}));
}
