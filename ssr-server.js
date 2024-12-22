const express = require("express");
const puppeteer = require("puppeteer");
const axios = require("axios");

function parseBoolStr(boolStr, defaultValue) {
  return boolStr ? boolStr === "true" : defaultValue;
}

const PROXY_URL = process.env.PSSR_PROXY_URL || "http://127.0.0.1:8000";
const PORT = process.env.PSSR_PORT_NUMBER ? parseInt(process.env.PSSR_PORT_NUMBER) : 3000;
const BROWSER_REFRESH_RATE = process.env.PSSR_BROWSER_REFRESH_RATE || 60000;
const BROWSER_COOLDOWN_TIME = process.env.PSSR_BROWSER_COOLDOWN_TIME || 10000;
const WHITELIST_REGEXP = new RegExp(process.env.PSSR_WHITELIST_REGEXP || ".*");
const BLACKLIST_REGEXP = new RegExp(process.env.PSSR_BLACKLIST_REGEXP || "^/(static|fonts|assets)/.*");

const LOG_WARNINGS = parseBoolStr(process.env.PSSR_LOG_WARNINGS, true);
const LOG_INFO = parseBoolStr(process.env.PSSR_LOG_INFO, true);
const LOG_DEBUG = parseBoolStr(process.env.PSSR_LOG_DEBUG, false);

const info = LOG_INFO ? console.log : () => null;
const debug = LOG_DEBUG ? console.log : () => null;
const warn = LOG_WARNINGS ? console.warn : () => null;

let currentBrowser;

async function closeBrowser(browser) {
  await new Promise((resolve) => setTimeout(resolve, BROWSER_COOLDOWN_TIME));
  const nOpenPages = (await browser.pages()).length - 1;
  if (nOpenPages > 0) {
    info(`Closing old browser with ${nOpenPages} open pages.`);
  }
  return browser.close();
}

async function refreshBrowser() {
  debug("Refreshing browser.");
  const oldBrowser = currentBrowser;
  currentBrowser = await puppeteer.launch({
    headless: true,
    args: ["--disable-gpu"],
  });
  if (oldBrowser) {
    await closeBrowser(oldBrowser);
  }
}

async function handleRequest(req, res) {
  debug("Incoming request for " + req.originalUrl);
  const url = PROXY_URL + req.originalUrl;
  const customHeaders = {
    "X-Redirect-By": "ssr-server",
    "X-Real-IP": req.headers["x-real-ip"] || req.connection.remoteAddress || "", 
    "X-Forwarded-For": req.headers["x-forwarded-for"] || req.connection.remoteAddress || "",
    "User-Agent": req.headers["user-agent"] || "",
  };
  if (WHITELIST_REGEXP.test(req.originalUrl) && !BLACKLIST_REGEXP.test(req.originalUrl)) {
    try {
      const content = await ssr(url, customHeaders);
      res.end(content);
    } catch (e) {
      debug(`SSR error for ${url}: ${e.message}`);
      res.status(500).send("SSR Failed: Unable to load page.");
    }
  } else {
    axios
      .get(url, { responseType: "stream", headers: customHeaders })
      .then((response) => {
        response.data.pipe(res);
      })
      .catch((error) => {
        console.error("Error:", error);
        res.status(500).send("Error");
      });
  }
}

async function ssr(url, customHeaders) {
  try {
    debug(`Opening ${url} in browser.`);
    const page = await currentBrowser.newPage();
    debug(customHeaders);
    await page.setExtraHTTPHeaders(customHeaders);
    await page.goto(url, { waitUntil: "networkidle0" });
    const content = await page.content();
    await page.close();
    return content;
  } catch (e) {
    info(`Error while waiting for ${url} to go idle. (${e.message})`);
    throw new Error(`SSR request failed for ${url}: ${e.message}`);
  }
}

async function init() {
  info("Starting.");
  await refreshBrowser();
  setInterval(refreshBrowser, BROWSER_REFRESH_RATE);
  info(`Browser started, starting server.`);
  const app = express();
  app.get("*/", handleRequest);
  app.listen(PORT, () => {
    info(`Now listening on port ${PORT}.`);
  });
}

init();
