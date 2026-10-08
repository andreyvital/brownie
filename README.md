# brownie

Lists court slots on [letzplay.me](https://letzplay.me/clavatenis/club). Built with Bun, Effect 4 and Playwright.

```bash
bun install
bunx playwright install chromium
bun start                          # free slots (HEADLESS=false to watch the browser)
bun start all 2026-10-09           # every slot on a date
bun start me                       # your reservations
```

## How it works

letzplay.me sits behind a Cloudflare managed challenge. The `cf_clearance` cookie is tied
to the browser's TLS fingerprint, so it can't be replayed from Bun's `fetch`. So:

1. `src/Browser.ts` launches headless Chromium (full build, new headless mode) and waits for
   the challenge to clear. The only trick needed is replacing `HeadlessChrome` with `Chrome`
   in the user agent; without it the challenge never resolves.
2. All further HTTP calls (login form post, schedule pages) are plain `fetch` calls that
   run *inside* that page (`page.evaluate`). There's no clicking or DOM automation.
3. `src/parse.ts` parses the server-rendered HTML into `Slot`s.

## Credentials

Stored encrypted in `.env` via [dotenvx](https://dotenvx.com) (`LETZPLAY_EMAIL`,
`LETZPLAY_PASSWORD`, optional `LETZPLAY_CLUB`). dotenvx put the private key in the macOS
Keychain (service `dotenvx`). `.env.keys` is gitignored in case you move it there. On
another machine, set `DOTENV_PRIVATE_KEY` (`bunx dotenvx keypair` prints it). Change a
value with `bunx dotenvx set LETZPLAY_PASSWORD <new>`.

Starting fresh: `cp .env.example .env`, fill it in, then `bunx dotenvx encrypt`.
