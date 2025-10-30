FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY index.ts ./

RUN npm run build

EXPOSE 3003
CMD ["npm", "start"]
