FROM oven/bun:1.3.1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Chromium plus the system libraries and fonts it needs.
RUN bunx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
# The encrypted .env ships with the image; DOTENV_PRIVATE_KEY decrypts it at runtime.
CMD ["bun", "start"]
