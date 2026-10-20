import {chromium, Browser, BrowserContext} from 'playwright-core';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {config, HttpError, log} from './config';

class BrowserWorker {
    active = 0;
    uses = 0;
    recycling = false;
    private browser?: Browser;
    private launching?: Promise<Browser>;
    private directory?: string;
    private startedAt = 0;

    get needsRecycle(): boolean {
        return this.uses >= config.browserMaxRenders || Boolean(this.browser &&
            (!this.browser.isConnected() || Date.now() - this.startedAt >= config.browserMaxAge));
    }

    async context(): Promise<BrowserContext> {
        this.launching ||= this.launch();
        const browser = await this.launching;
        return browser.newContext({userAgent: 'ssr-renderer', serviceWorkers: 'block', acceptDownloads: false});
    }

    private async launch(): Promise<Browser> {
        this.directory = await mkdtemp(join(tmpdir(), 'renderer-'));
        try {
            this.browser = await chromium.launch({
                headless: true,
                timeout: 10000,
                env: {...process.env, TMPDIR: this.directory},
                downloadsPath: join(this.directory, 'downloads'),
                tracesDir: join(this.directory, 'traces'),
            });
            this.startedAt = Date.now();
            log('browser_started');
            return this.browser;
        } catch (error) {
            // Playwright disposes a failed launch before rejecting its promise.
            await rm(this.directory, {recursive: true, force: true});
            this.directory = undefined;
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.launching) await this.launching.catch(() => undefined);
        // Playwright owns the process; close it before deleting Chromium's TMPDIR.
        if (this.browser) await withBrowserDeadline(this.browser.close());
        if (this.directory) await rm(this.directory, {recursive: true, force: true, maxRetries: 3});
        this.browser = undefined;
        this.launching = undefined;
        this.directory = undefined;
        this.uses = 0;
        this.startedAt = 0;
    }
}

type Lease = {context: BrowserContext; release: () => Promise<void>};

async function withBrowserDeadline<T>(close: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([close, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Browser cleanup timed out')), 10000);
        })]);
    } finally {if (timer) clearTimeout(timer);}
}
type Pending = {
    resolve: (worker: BrowserWorker) => void;
    reject: (error: Error) => void;
    dispose: () => void;
};

export class BrowserPool {
    private readonly workers = Array.from({length: config.browsers}, () => new BrowserWorker());
    private pending: Pending[] = [];
    private stopped = false;

    get active(): number {return this.workers.reduce((sum, worker) => sum + worker.active, 0);}
    get queued(): number {return this.pending.length;}

    private dispatch(): void {
        if (this.stopped) return;
        for (const worker of this.workers) {
            if (worker.recycling) continue;
            if (worker.needsRecycle) {
                if (worker.active === 0) {
                    worker.recycling = true;
                    void worker.close().then(() => {
                        worker.recycling = false;
                        this.dispatch();
                    }).catch(error => this.fatal(error));
                }
                continue;
            }
            while (worker.active < config.pagesPerBrowser && this.pending.length && !worker.needsRecycle) {
                const request = this.pending.shift()!;
                request.dispose();
                worker.active++;
                worker.uses++;
                request.resolve(worker);
            }
        }
    }

    private fatal(error: unknown): never {
        log('browser_cleanup_failed', {error: String(error)});
        // A browser that cannot be stopped cannot be safely reused or cleaned.
        // Let Docker stop the remaining processes and reset the container tmpfs.
        process.exit(1);
    }

    async acquire(signal: AbortSignal, background = false): Promise<Lease> {
        if (this.stopped) throw new HttpError(503, 'Renderer is stopping');
        signal.throwIfAborted();
        if (this.pending.length >= config.queueLimit ||
            (background && (this.pending.length || this.active >= config.browsers * config.pagesPerBrowser))) {
            throw new HttpError(503, 'Renderer is busy');
        }
        const worker = await new Promise<BrowserWorker>((resolve, reject) => {
            const remove = (error: Error) => {
                this.pending = this.pending.filter(item => item !== request);
                request.dispose();
                reject(error);
            };
            const abort = () => remove(new HttpError(499, 'Client disconnected'));
            const timer = setTimeout(() => remove(new HttpError(503, 'Render queue timeout')), config.queueTimeout);
            const request: Pending = {
                resolve, reject,
                dispose: () => {clearTimeout(timer); signal.removeEventListener('abort', abort);},
            };
            this.pending.push(request);
            signal.addEventListener('abort', abort, {once: true});
            if (signal.aborted) abort();
            this.dispatch();
        });
        let context: BrowserContext;
        try {
            signal.throwIfAborted();
            context = await withBrowserDeadline(worker.context());
            if (signal.aborted) {await context.close(); signal.throwIfAborted();}
        } catch (error) {
            worker.uses = config.browserMaxRenders;
            worker.active--;
            // A rejected launch promise must be reset before another request.
            if (worker.active === 0) {
                worker.recycling = true;
                try {await worker.close();} catch (failure) {this.fatal(failure);}
                worker.recycling = false;
            }
            this.dispatch();
            throw error;
        }
        let releasing: Promise<void> | undefined;
        return {
            context,
            release: () => releasing ||= (async () => {
                try {await withBrowserDeadline(context.close());}
                catch (error) {log('context_close_failed', {error: String(error)}); worker.uses = config.browserMaxRenders;}
                finally {worker.active--; this.dispatch();}
            })(),
        };
    }

    async close(): Promise<void> {
        this.stopped = true;
        for (const request of this.pending.splice(0)) {
            request.dispose();
            request.reject(new HttpError(503, 'Renderer is stopping'));
        }
        await Promise.all(this.workers.map(worker => worker.close()));
    }
}
