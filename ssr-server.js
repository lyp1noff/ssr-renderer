const express = require('express');
const puppeteer = require('puppeteer');

const app = express();

const BLOCKED_RESOURCE_TYPES = ['image', 'media', 'stylesheet', 'font'];


app.get('*', async (req, res) => {
    const targetUrl = `https://helen-marlen.com${req.originalUrl}`;

    console.log(`Rendering: ${targetUrl}`);

    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        const content = await page.content();

        res.send(content);
    } catch (error) {
        console.error(`Failed to render ${targetUrl}:`, error);
        res.status(500).send('Internal Server Error');
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Запуск сервера
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`SSR server running on http://localhost:${PORT}`);
});
