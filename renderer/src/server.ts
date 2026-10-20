import {createServer, ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {config, HttpError, log} from './config';
import {BrowserPool} from './browser-pool';
import {render} from './renderer';
import {Telemetry} from './telemetry';

const pool = new BrowserPool();
const telemetry = new Telemetry();
const controllers = new Set<AbortController>();
let stopping = false;
let checking = false;

function respond(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
    res.end(body);
}

async function checkRendering(): Promise<void> {
    if (checking || stopping || !telemetry.needsCheck) return;
    checking = true;
    const controller = new AbortController();
    controllers.add(controller);
    try {
        const page = await render(pool, new URL(config.checkPath, config.origin), controller.signal, true);
        if (page.status < 200 || page.status >= 400) throw new Error(`Readiness page returned ${page.status}`);
        telemetry.success();
    } catch (error) {
        if (!(error instanceof HttpError && error.message === 'Renderer is busy')) {
            log('readiness_failed', {error: String(error)});
        }
    } finally {controllers.delete(controller); checking = false;}
}

const server = createServer(async (req, res) => {
    if (stopping) return respond(res, 503, 'Renderer is stopping', {'Retry-After': '5'});
    if (req.url === '/health') return respond(res, 200, 'ok');
    if (req.url === '/ready') return respond(res, telemetry.recentSuccess ? 200 : 503,
        JSON.stringify({ready: telemetry.recentSuccess}), {'Content-Type': 'application/json'});
    if (req.url === '/metrics') return respond(res, 200, telemetry.metrics(pool), {'Content-Type': 'text/plain; version=0.0.4'});
    if (!['GET', 'HEAD'].includes(req.method || '')) return respond(res, 405, 'Method not allowed', {Allow: 'GET, HEAD'});
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return respond(res, 400, 'Invalid URL');
    let url: URL;
    try {
        url = new URL(req.url, config.origin);
        if (url.origin !== config.origin.origin) throw new Error();
    } catch {return respond(res, 400, 'Invalid URL');}

    const id = randomUUID();
    const started = Date.now();
    const controller = new AbortController();
    controllers.add(controller);
    const disconnect = () => {if (!res.writableEnded) controller.abort();};
    res.on('close', disconnect);
    let status = 500;
    try {
        const result = await render(pool, url, controller.signal);
        status = result.status;
        const headers: Record<string, string> = {'Content-Type': 'text/html; charset=utf-8', 'X-SSR-Served': 'true'};
        if (status === 200) {
            telemetry.success();
            headers['Cache-Control'] = `public, max-age=${config.cacheTTL}`;
        }
        if (result.location) headers.Location = result.location;
        respond(res, status, req.method === 'HEAD' ? '' : result.html, headers);
    } catch (error) {
        status = controller.signal.aborted ? 499 : error instanceof HttpError ? error.status : 502;
        if (!controller.signal.aborted) respond(res, status, 'Rendering unavailable', {'Retry-After': '5'});
        log('render_failed', {id, status, error: String(error), cause: String((error as Error).cause || '')});
    } finally {
        controllers.delete(controller);
        res.removeListener('close', disconnect);
        const seconds = (Date.now() - started) / 1000;
        telemetry.record(status, seconds);
        log('request_completed', {id, path: url.pathname, status, seconds});
    }
});
server.headersTimeout = 10000;
server.requestTimeout = 40000;
server.listen(config.port, () => {log('renderer_started', {port: config.port, capacity: config.browsers * config.pagesPerBrowser}); void checkRendering();});
const timer = setInterval(() => void checkRendering(), 30000);

async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), 30000);
    for (const controller of controllers) controller.abort();
    server.close();
    try {
        await pool.close();
        clearTimeout(deadline);
        server.closeAllConnections();
        process.exit(0);
    } catch (error) {log('shutdown_failed', {error: String(error)}); process.exit(1);}
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
