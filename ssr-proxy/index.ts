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

  const targetUrl = new URL(req.url, ORIGIN_BASE_URL).toString();
  console.log(`[SSR] Rendering via WS: ${targetUrl}`);

  const browser = await chromium.connectOverCDP(BROWSERLESS_WS);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.route("**/*", route => {
      const url = route.request().url();

      if (!url.startsWith(ORIGIN_BASE_URL)) {
        return route.abort();
      }

      if (url.match(/\.(png|jpg|jpeg|gif|webp|svg|mp4|woff2?|ttf|eot|css)$/i)) {
        return route.abort();
      }

      return route.continue();
    });

    await page.goto(targetUrl, {waitUntil: "networkidle", timeout: 10000});
    const html = await page.content();

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-SSR-Served": "true",
    });
    res.end(html);
  } catch (err) {
    console.error(`[SSR] Failed for ${targetUrl}:`, err);
    res.writeHead(500).end("SSR failed");
  } finally {
    await page.close();
    await browser.close();
  }
});

server.listen(PORT, () =>
  console.log(`[SSR] Proxy running on port ${PORT} → ${BROWSERLESS_WS}`)
);
