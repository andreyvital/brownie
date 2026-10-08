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
- `GET /live` shows a picture from the court camera that refreshes every 30 seconds
  (see [Court camera](#court-camera)). `GET /live.jpg` is the picture itself.
- `GET /send` sends a WhatsApp message to one of `WHATSAPP_CONTACTS` (see [WhatsApp](#whatsapp)),
  behind HTTP basic auth with `SEND_PASSWORD` (any user name).
- `GET /status` returns `{ uptime, whatsAppStatus }` (seconds since start, and `open`, `connecting`,
  `pairing`, `unlinked` or `replaced`).
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

## Court camera

`src/ezviz/Ezviz.ts` signs into EZVIZ's consumer API (the one the EZVIZ app uses) with
`EZVIZ_EMAIL` / `EZVIZ_PASSWORD`, asks camera `EZVIZ_CAMERA` (default `BG5113153`) to take a
picture and downloads it. Pictures are kept for 30 seconds, so viewers don't each wake the
camera. Without the login, `/live` returns 503 and the rest of the app runs as usual.

Why not live video: the camera is owned by the club's EZVIZ account and only shared with ours.
EZVIZ's web player ([`ezuikit-js`](https://www.npmjs.com/package/ezuikit-js)) needs an Open
Platform key from the *owning* account (console for South America:
https://isaopen.ezviz.com/console/home.html). With one, the player version in commit `da6eb83`
can be brought back.

The first login from a new machine may be answered with code 6002, meaning EZVIZ wants a
verification code. The `featureCode` header is fixed so that only happens once.

## Credentials

Stored encrypted in `.env` via [dotenvx](https://dotenvx.com) (`LETZPLAY_EMAIL`,
`LETZPLAY_PASSWORD`, optional `LETZPLAY_CLUB`). The private key that decrypts it lives in
`.env.keys`, which is gitignored: back it up, it can't be recovered. On another machine,
copy `.env.keys` over or set `DOTENV_PRIVATE_KEY`. Change a value with
`bunx dotenvx set LETZPLAY_PASSWORD <new>`.

Starting fresh: `cp .env.example .env`, fill it in, then `bunx dotenvx encrypt`.

## WhatsApp

`bun run whatsapp "message"` sends a message to `WHATSAPP_TO` from a second WhatsApp account,
linked as a device with [Baileys](https://github.com/WhiskeySockets/Baileys). The first run
prints a pairing code for the account in `WHATSAPP_PHONE`; the session is then kept in
`.whatsapp-auth/` (gitignored). WhatsApp unlinks it if that account's phone is inactive for 14 days.

On Railway the session lives on a volume mounted at `/data` (`WHATSAPP_AUTH_DIR` in the
`Dockerfile`). `just whatsapp-volume` creates it once and `just whatsapp-push` copies the local
session there. The server keeps one connection open for `/send`; if it isn't linked yet the page
shows a pairing code. Don't keep sending from both places afterwards: a session used in two places
breaks.
