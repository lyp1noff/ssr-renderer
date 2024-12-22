FROM debian:12-slim

RUN apt-get update && apt-get install -y \
    nodejs \
    npm

ENV PUPPETEER_CACHE_DIR=/app/.cache/ \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app
RUN useradd -m -d /home/chromeuser -s /bin/bash chromeuser \
    && chown -R chromeuser:chromeuser /app /home/chromeuser \
    && chmod -R 755 /app

COPY package*.json ./
RUN npm install
COPY . .

WORKDIR /app/.cache
RUN npx @puppeteer/browsers install chrome@131.0.6778.204 --install-deps

USER chromeuser

WORKDIR /app
EXPOSE 3000
CMD ["sh", "-c", "node ssr-server.js"]
