# Official Playwright image: browsers and their system deps preinstalled under
# /ms-playwright. Its version must match the playwright package in bun.lock.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

COPY --from=oven/bun:1.3.1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
# The encrypted .env ships with the image; DOTENV_PRIVATE_KEY decrypts it at runtime.
CMD ["bun", "start"]
