const express = require("express");
const puppeteer = require("puppeteer");

function parseBoolStr(boolStr, defaultValue) {
  return boolStr ? boolStr === "true" : defaultValue;
}

const PORT = 3000;

const LOG_WARNINGS = parseBoolStr(process.env.PSSR_LOG_WARNINGS, true);
const LOG_INFO = parseBoolStr(process.env.PSSR_LOG_INFO, true);
const LOG_DEBUG = parseBoolStr(process.env.PSSR_LOG_DEBUG, false);

const info = LOG_INFO ? console.log : () => null;
const debug = LOG_DEBUG ? console.log : () => null;
const warn = LOG_WARNINGS ? console.warn : () => null;

const BLOCKED_RESOURCE_TYPES = ["image", "media", "stylesheet", "font"];

let currentBrowser;

async function closeBrowser(browser) {
    await new Promise(resolve => setTimeout(resolve, BROWSER_COOLDOWN_TIME));
    const nOpenPages = (await browser.pages()).length - 1;
    if (nOpenPages > 0) {
      info(`Closing old browser with ${nOpenPages} open pages.`);
    }
    return browser.close();
  }

async function refreshBrowser() {
    debug('Refreshing browser.');
    const oldBrowser = currentBrowser;
    // currentBrowser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
    currentBrowser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-setuid-sandbox']});
    // currentBrowser = await puppeteer.launch({headless: true});
    if (oldBrowser) {
      await closeBrowser(oldBrowser);
    }
  }

async function handleRequest(req, res) {
  const targetUrl = `https://helen-marlen.com${req.originalUrl}`;

  console.log(`Rendering: ${targetUrl}`);

  try {
    const page = await currentBrowser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(targetUrl, { waitUntil: "networkidle2" });

    const content = await page.content();
    page.close();

    res.send(content);
  } catch (error) {
    console.error(`Failed to render ${targetUrl}:`, error);
    res.status(500).send("Internal Server Error");
  }
}

async function init() {
  info("Starting.");
  await refreshBrowser();
  setInterval(refreshBrowser, 60000);
  info(`Browser started, starting server.`);
  const app = express();
  app.get("*", handleRequest);
  app.listen(PORT, () => {
    info(`Now listening on port ${PORT}.`);
  });
}

init();
