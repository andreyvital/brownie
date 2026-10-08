import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Cache, Cause, Config, Duration, Effect, Exit, Layer, Option, Redacted, Runtime } from "effect"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse, UrlParams } from "effect/http"
import { timingSafeEqual } from "node:crypto"
import { Ezviz, EzvizLive } from "~/ezviz/Ezviz"
import { Letzplay, LetzplayLive } from "~/letzplay/Letzplay"
import { renderAgenda } from "~/server/agenda"
import { renderLive } from "~/server/live"
import { type Contact, renderSend } from "~/server/send"
import { WhatsApp, WhatsAppLive } from "~/whatsapp/WhatsApp"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// YYYY-MM-DD for "now" in the club's timezone (servers usually run in UTC).
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())

const Routes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter
    const letzplay = yield* Letzplay
    const ezviz = yield* Ezviz
    const whatsapp = yield* WhatsApp
    const club = yield* Config.String("LETZPLAY_CLUB").pipe(Config.withDefault("clavatenis"))
    const timeZone = yield* Config.String("CLUB_TIMEZONE").pipe(Config.withDefault("America/Sao_Paulo"))

    // Each scrape takes a couple of seconds, so keep a day's agenda for a few
    // minutes. Failures aren't cached. Remember when it was fetched so the page
    // can say how fresh it is.
    const agenda = yield* Cache.makeWith(
      (date: string) => letzplay.listSlots({ date }).pipe(Effect.map((slots) => ({ slots, fetchedAt: new Date() }))),
      {
        capacity: 32,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.minutes(5) : Duration.zero),
      },
    )

    yield* router.add("GET", "/health", HttpServerResponse.text("ok"))

    // Public, so only the connection state: no pairing code, and it never starts linking
    yield* router.add(
      "GET",
      "/status",
      whatsapp.currentStatus.pipe(
        Effect.map((status) =>
          HttpServerResponse.jsonUnsafe({ uptime: Math.floor(process.uptime()), whatsAppStatus: status.state }),
        ),
      ),
    )

    yield* router.add(
      "GET",
      "/live",
      ezviz.configured
        ? HttpServerResponse.html(renderLive())
        : HttpServerResponse.text("The court camera isn't set up yet.", { status: 503 }),
    )

    yield* router.add(
      "GET",
      "/live.jpg",
      ezviz.snapshot.pipe(
        Effect.map((snapshot) =>
          HttpServerResponse.uint8Array(snapshot.image, {
            contentType: snapshot.contentType,
            headers: { "cache-control": "no-store" },
          }),
        ),
        Effect.catch((error) =>
          Effect.logError("failed to get a camera snapshot", error).pipe(
            Effect.as(HttpServerResponse.empty({ status: ezviz.configured ? 502 : 503 })),
          ),
        ),
      ),
    )

    yield* router.add(
      "GET",
      "/",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const today = todayIn(timeZone)
        const param = new URL(request.url, "http://localhost").searchParams.get("date")
        const date = param && DATE_RE.test(param) ? param : today

        const { slots, fetchedAt } = yield* Cache.get(agenda, date)
        return HttpServerResponse.html(renderAgenda({ club, date, today, slots, fetchedAt, timeZone }))
      }).pipe(
        Effect.catch((error) =>
          Effect.logError("failed to load agenda", error).pipe(
            Effect.as(
              HttpServerResponse.text("Couldn't load the agenda from letzplay.me, try again shortly.", { status: 502 }),
            ),
          ),
        ),
      ),
    )
  }),
)

// "Andrey=5581995698652,Steffany=5532998242044"
const parseContacts = (value: string): ReadonlyArray<Contact> =>
  value.split(",").flatMap((entry) => {
    const [name, phone] = entry.split("=").map((s) => s.trim())
    return name && phone ? [{ name, phone: phone.replace(/\D/g, "") }] : []
  })

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest()

// /send can message real people from our account, so it sits behind HTTP basic auth
// (any user name, SEND_PASSWORD as the password)
const isAuthorized = (request: HttpServerRequest.HttpServerRequest, password: Redacted.Redacted<string>) => {
  const header = Option.getOrElse(Headers.get(request.headers, "authorization"), () => "")
  if (!header.startsWith("Basic ")) return false
  const decoded = Buffer.from(header.slice(6), "base64").toString()
  const given = decoded.slice(decoded.indexOf(":") + 1)
  return timingSafeEqual(sha256(given), sha256(Redacted.value(password)))
}

const SendRoutes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter
    const whatsapp = yield* WhatsApp
    const contacts = parseContacts(yield* Config.String("WHATSAPP_CONTACTS").pipe(Config.withDefault("")))
    const password = yield* Config.option(Config.Redacted("SEND_PASSWORD"))

    const guarded = (
      handler: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse>,
    ) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (Option.isNone(password) || contacts.length === 0) {
          return HttpServerResponse.text("Sending isn't set up (SEND_PASSWORD, WHATSAPP_CONTACTS).", { status: 503 })
        }
        if (!isAuthorized(request, password.value)) {
          return HttpServerResponse.text("Unauthorized", {
            status: 401,
            headers: { "www-authenticate": 'Basic realm="brownie"' },
          })
        }
        return yield* handler(request)
      })

    yield* router.add(
      "GET",
      "/send",
      guarded(() => whatsapp.status.pipe(Effect.map((status) => HttpServerResponse.html(renderSend({ contacts, status }))))),
    )

    yield* router.add(
      "POST",
      "/send",
      guarded((request) =>
        Effect.gen(function* () {
          const params = yield* request.urlParamsBody.pipe(Effect.orElseSucceed(() => UrlParams.empty))
          const to = Option.getOrElse(UrlParams.getFirst(params, "to"), () => "")
          const text = Option.getOrElse(UrlParams.getFirst(params, "text"), () => "").trim()
          const contact = contacts.find((c) => c.name === to)

          const result = !contact
            ? { ok: false, message: "Pick who to send it to" }
            : !text
              ? { ok: false, message: "Write a message first" }
              : yield* whatsapp.send(contact.phone, text).pipe(
                  Effect.as({ ok: true, message: `Sent to ${contact.name}` }),
                  Effect.catch((error) =>
                    Effect.logError("failed to send a WhatsApp message", error).pipe(
                      Effect.as({ ok: false, message: `Couldn't send: ${error.message}` }),
                    ),
                  ),
                )

          const status = yield* whatsapp.status
          // Keep the text after a failure so it can be sent again
          return HttpServerResponse.html(renderSend({ contacts, status, result, to, text: result.ok ? "" : text })).pipe(
            HttpServerResponse.setStatus(result.ok ? 200 : 400),
          )
        }),
      ),
    )
  }),
)

// Railway (and most hosts) pass the port to listen on via PORT.
const port = Number(process.env.PORT ?? 3000)

HttpRouter.serve(Layer.mergeAll(Routes, SendRoutes)).pipe(
  Layer.provide(LetzplayLive),
  Layer.provide(EzvizLive),
  Layer.provide(WhatsAppLive),
  Layer.provide(BunHttpServer.layer({ port })),
  Layer.launch,
  // Railway stops the old deployment with a signal on every deploy. Exit 0 for that rather
  // than the default 130, which Railway reports as a crash
  BunRuntime.runMain({
    teardown: (exit, onExit) =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
  }),
)
