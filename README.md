# brownie

A small web page showing today's court agenda from
[letzplay.me](https://letzplay.me/clavatenis/club). Built with Bun, Effect 4 and Playwright.

```bash
bun install
bunx playwright install chromium
bun start                          # http://localhost:3000 (HEADLESS=false to watch the browser)
```

- `GET /` shows today's agenda (in `CLUB_TIMEZONE`, default `America/Sao_Paulo`).
  `?date=YYYY-MM-DD` shows another day. Results are cached for 5 minutes.
- `GET /live` plays the court camera live (see [Live camera](#live-camera)).
- `GET /health` is for the platform health check. The server only starts listening once
  the browser has cleared Cloudflare and logged in.

## Deploying

The app runs on Railway (project `brownie`, https://brownie-production.up.railway.app) from the
`Dockerfile`, which is based on the official Playwright image. The `mcr.microsoft.com/playwright`
tag must match the `playwright` version in `bun.lock`. The only variable the service needs is
`DOTENV_PRIVATE_KEY`.

```bash
railway up --service brownie
```

## How it works

letzplay.me sits behind a Cloudflare managed challenge. The `cf_clearance` cookie is tied
to the browser's TLS fingerprint, so it can't be replayed from Bun's `fetch`. So:

1. `src/letzplay/Browser.ts` launches headless Chromium (full build, new headless mode) and waits for
   the challenge to clear. The only trick needed is replacing `HeadlessChrome` with `Chrome`
   in the user agent; without it the challenge never resolves.
2. All further HTTP calls (login form post, schedule pages) are plain `fetch` calls that
   run *inside* that page (`page.evaluate`). There's no clicking or DOM automation.
3. `src/letzplay/parse.ts` parses the server-rendered HTML into `Slot`s.

## Live camera

`/live` embeds EZVIZ's own web player, [`ezuikit-js`](https://www.npmjs.com/package/ezuikit-js). It
plays the camera's `ezopen://` stream through EZVIZ's cloud and decodes H.265 in WebAssembly, so
it works in every major browser without a relay. Its decoder files are served from
`node_modules/ezuikit-js` under `/ezuikit/`.

The player needs an EZVIZ Open Platform access token. `src/ezviz/Ezviz.ts` gets one from
`EZVIZ_APP_KEY` / `EZVIZ_APP_SECRET` (an app created at https://open.ezvizlife.com with the
account that owns the camera) and caches it until an hour before it expires. The token is
handed to the browser, so anyone who can open `/live` can watch that account's cameras until
it expires. Without the keys, `/live` returns 503 and the rest of the app runs as usual.

## Credentials

Stored encrypted in `.env` via [dotenvx](https://dotenvx.com) (`LETZPLAY_EMAIL`,
`LETZPLAY_PASSWORD`, optional `LETZPLAY_CLUB`). The private key that decrypts it lives in
`.env.keys`, which is gitignored: back it up, it can't be recovered. On another machine,
copy `.env.keys` over or set `DOTENV_PRIVATE_KEY`. Change a value with
`bunx dotenvx set LETZPLAY_PASSWORD <new>`.

Starting fresh: `cp .env.example .env`, fill it in, then `bunx dotenvx encrypt`.
