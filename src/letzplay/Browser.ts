import { Config, Context, Data, Effect, Layer } from "effect"
import { chromium, type Browser as PlaywrightBrowser, type Page } from "playwright"

export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export interface FetchResult {
  readonly status: number
  readonly url: string
  readonly body: string
}

/**
 * A real Chrome page that has cleared letzplay.me's Cloudflare challenge.
 *
 * Cloudflare binds `cf_clearance` to the browser's TLS fingerprint, so the
 * cookie can't be replayed from Bun's `fetch`. Every HTTP call therefore runs
 * as a `fetch` inside the page, which reuses the browser's cookies and TLS.
 */
export class Browser extends Context.Service<
  Browser,
  {
    readonly fetch: (path: string, init?: { method?: string; form?: Record<string, string> }) => Effect.Effect<FetchResult, BrowserError>
  }
>()("Browser") {}

const BASE_URL = "https://letzplay.me"

const fetchInPage = (page: Page, path: string, init: { method?: string; form?: Record<string, string> } = {}) =>
  Effect.tryPromise({
    try: () =>
      page.evaluate(async ({ path, method, form }) => {
        const res = await fetch(path, {
          method: method ?? "GET",
          body: form ? new URLSearchParams(form) : undefined,
        })
        return { status: res.status, url: res.url, body: await res.text() }
      }, { path, method: init.method, form: init.form }),
    catch: (cause) => new BrowserError({ message: `fetch ${path} failed`, cause }),
  })

const userAgentOf = async (browser: PlaywrightBrowser) => {
  const page = await browser.newPage()
  try {
    return await page.evaluate(() => navigator.userAgent)
  } finally {
    await page.close()
  }
}

export const BrowserLive =Layer.effect(
  Browser,
  Effect.gen(function* () {
    const headless = yield* Config.Boolean("HEADLESS").pipe(Config.withDefault(true))

    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          chromium.launch({
            headless,
            // Full Chromium in new headless mode rather than the stripped-down
            // headless shell, so it looks as close to a real Chrome as possible.
            channel: "chromium",
            args: ["--disable-blink-features=AutomationControlled"],
          }),
        catch: (cause) => new BrowserError({ message: "failed to launch Chrome", cause }),
      }),
      (browser) => Effect.promise(() => browser.close()),
    )

    const page = yield* Effect.tryPromise({
      try: async () => {
        // Headless reports "HeadlessChrome" in its user agent, which is what
        // Cloudflare's challenge rejects. Advertise the regular Chrome one.
        const userAgent = (await userAgentOf(browser)).replace("HeadlessChrome", "Chrome")
        const page = await browser.newPage({ userAgent })
        await page.goto(`${BASE_URL}/login`)
        // The challenge page redirects to the real login form once solved.
        await page.waitForSelector("#user_login", { timeout: 60_000 })
        return page
      },
      catch: (cause) => new BrowserError({ message: "failed to clear Cloudflare challenge", cause }),
    })
    yield* Effect.logInfo("cleared Cloudflare challenge")

    return { fetch: (path, init) => fetchInPage(page, path, init) }
  }),
)
