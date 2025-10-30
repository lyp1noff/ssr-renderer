import {createServer} from "http";
import {chromium} from "playwright-core";

const PORT = 3003;
const ORIGIN_BASE_URL = process.env.ORIGIN_BASE_URL || "http://127.0.0.1:10000";
const BROWSERLESS_WS = process.env.BROWSERLESS_WS || "ws://browserless:3000";

const server = createServer(async (req, res) => {
  if (!req.url) return;
  if (req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }

  if (/\.(js|css|png|jpg|jpeg|gif|svg|json|ico|woff|woff2|ttf|eot)$/i.test(req.url)) {
    res.writeHead(403, {"Content-Type": "text/plain"});
    res.end("Skipped (static asset)");
    return;
  }

  const targetUrl = new URL(req.url, ORIGIN_BASE_URL).toString();
  console.log(`[SSR] Rendering via WS: ${targetUrl}`);

  try {
    const browser = await chromium.connectOverCDP(BROWSERLESS_WS);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setExtraHTTPHeaders({
      "X-Redirect-By": "ssr-server",
      "User-Agent": "SSR-Renderer",
    });

    await page.goto(targetUrl, {waitUntil: "domcontentloaded", timeout: 5000});
    await page.waitForFunction('window.prerenderReady === true', {timeout: 10000});
    const html = await page.content();
    await page.close();
    await browser.close();

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-SSR-Served": "true",
    });
    res.end(html);
  } catch (err) {
    console.error(`[SSR] Failed for ${targetUrl}:`, err);
    res.writeHead(500).end("SSR failed");
  }
});

server.listen(PORT, () =>
  console.log(`[SSR] Proxy running on port ${PORT} → ${BROWSERLESS_WS}`)
);
