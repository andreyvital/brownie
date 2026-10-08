import { Config, Context, Data, Effect, Layer, Redacted } from "effect"
import { parse } from "node-html-parser"
import { Browser, BrowserLive, type BrowserError } from "~/letzplay/Browser"
import { parseSlotPage, type Slot } from "~/letzplay/parse"

export class LoginError extends Data.TaggedError("LoginError")<{
  readonly message: string
}> {}

export interface SlotFilters {
  readonly filter?: "available" | "me"
  readonly date?: string // YYYY-MM-DD
  readonly period?: "morning" | "afternoon" | "night"
  readonly court?: number
}

const PERIODS = { morning: "1", afternoon: "2", night: "3" } as const

export class Letzplay extends Context.Service<
  Letzplay,
  {
    /** Every slot matching the filters, following pagination. */
    readonly listSlots: (filters?: SlotFilters) => Effect.Effect<ReadonlyArray<Slot>, BrowserError | LoginError>
  }
>()("Letzplay") {}

const login = Effect.fn("login")(function* (
  browser: Browser["Service"],
  email: string,
  password: Redacted.Redacted<string>,
) {
  const page = yield* browser.fetch("/login")
  // Carry over the hidden fields (authenticity_token, form_token, ...).
  const form = Object.fromEntries(
    parse(page.body)
      .querySelectorAll("form#new_user input[type=hidden]")
      .map((input) => [input.getAttribute("name")!, input.getAttribute("value") ?? ""]),
  )
  const res = yield* browser.fetch("/login", {
    method: "POST",
    form: { ...form, "user[login]": email, "user[password]": Redacted.value(password) },
  })
  // A successful login redirects away from /login (to /u/feed).
  if (new URL(res.url).pathname === "/login") {
    return yield* new LoginError({ message: "login failed, check LETZPLAY_EMAIL / LETZPLAY_PASSWORD" })
  }
  yield* Effect.logInfo(`logged in as ${email}`)
})

export const LetzplayLive = Layer.effect(
  Letzplay,
  Effect.gen(function* () {
    const club = yield* Config.String("LETZPLAY_CLUB").pipe(Config.withDefault("clavatenis"))
    const email = yield* Config.String("LETZPLAY_EMAIL")
    const password = yield* Config.Redacted("LETZPLAY_PASSWORD")
    const browser = yield* Browser

    yield* login(browser, email, password)

    const fetchPage = Effect.fn("fetchPage")(function* (filters: SlotFilters, page: number) {
      const params = new URLSearchParams({ page: String(page) })
      if (filters.filter) params.set("filter", filters.filter)
      if (filters.date) params.set("date", filters.date)
      if (filters.period) params.set("period", PERIODS[filters.period])
      if (filters.court) params.set("court", String(filters.court))
      const path = `/${club}/club?${params}`

      let res = yield* browser.fetch(path)
      // An expired session redirects to /login; log in again and retry once.
      if (new URL(res.url).pathname === "/login") {
        yield* Effect.logInfo("session expired")
        yield* login(browser, email, password)
        res = yield* browser.fetch(path)
      }
      return parseSlotPage(res.body)
    })

    const listSlots = Effect.fn("listSlots")(function* (filters: SlotFilters = {}) {
      const slots: Array<Slot> = []
      for (let page = 1; ; page++) {
        const result = yield* fetchPage(filters, page)
        slots.push(...result.slots)
        if (!result.hasNextPage) return slots
      }
    })

    return { listSlots }
  }),
).pipe(Layer.provide(BrowserLive))
