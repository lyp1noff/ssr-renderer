import {BrowserPool} from './browser-pool';
import {config, HttpError} from './config';

export type RenderedPage = {status: number; html: string; location?: string};

export async function render(pool: BrowserPool, url: URL, signal: AbortSignal, background = false): Promise<RenderedPage> {
    const lease = await pool.acquire(signal, background);
    let expired = false;
    const cancel = () => {void lease.release();};
    signal.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(() => {expired = true; cancel();}, config.renderTimeout);
    try {
        signal.throwIfAborted();
        const page = await lease.context.newPage();
        page.setDefaultTimeout(config.renderTimeout);
        await page.route('**/*', route => {
            const request = route.request();
            const target = new URL(request.url());
            const allowed = request.isNavigationRequest() && request.frame() === page.mainFrame()
                ? target.origin === config.origin.origin : config.allowedOrigins.has(target.origin);
            return allowed && !['image', 'media', 'font'].includes(request.resourceType())
                ? route.continue() : route.abort();
        });
        const response = await page.goto(url.href, {waitUntil: 'domcontentloaded'});
        if (!response) throw new HttpError(502, 'Origin returned no document');
        if (response.status() >= 400) return {status: response.status(), html: await page.content()};

        // The application publishes its final status only after its content is ready.
        // No network-idle guesses, text matching, or knowledge of application APIs.
        const marker = await page.waitForFunction(() => {
            const document = (globalThis as any).document;
            const value = document.querySelector('[data-render-status]')?.getAttribute('data-render-status');
            const status = Number(value);
            return Number.isInteger(status) && (status === 200 || (status >= 400 && status <= 599)) ? status : false;
        });
        const status = await marker.jsonValue() as number;
        const finalURL = new URL(page.url());
        if (finalURL.origin !== url.origin) throw new HttpError(502, 'External navigation is not allowed');
        if (status !== 200) return {status, html: await page.content()};
        if (finalURL.pathname !== url.pathname || finalURL.search !== url.search) {
            let redirectStatus = 302;
            let previous = response.request().redirectedFrom();
            while (previous) {
                const redirect = await previous.response();
                if (redirect) redirectStatus = redirect.status();
                previous = previous.redirectedFrom();
            }
            return {status: redirectStatus, html: '', location: finalURL.pathname + finalURL.search};
        }
        return {status, html: await page.content()};
    } catch (error) {
        if (signal.aborted) throw new HttpError(499, 'Client disconnected');
        if (expired || (error as Error).name === 'TimeoutError') throw new HttpError(504, 'Render timeout');
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, 'Browser rendering failed', {cause: error});
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        await lease.release();
    }
}
