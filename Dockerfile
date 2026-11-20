FROM node:22-bookworm-slim
ENV NODE_ENV=production
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save --package-lock=false --omit=dev playwright-core@1.56.1
COPY . .
CMD ["node", "index.js"]
