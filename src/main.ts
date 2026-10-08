import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Cache, Config, Duration, Effect, Exit, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Ezviz, EzvizLive } from "~/ezviz/Ezviz"
import { Letzplay, LetzplayLive } from "~/letzplay/Letzplay"
import { renderAgenda } from "~/server/agenda"
import { renderLive } from "~/server/live"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// YYYY-MM-DD for "now" in the club's timezone (servers usually run in UTC).
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())

const Routes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter
    const letzplay = yield* Letzplay
    const ezviz = yield* Ezviz
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

// Railway (and most hosts) pass the port to listen on via PORT.
const port = Number(process.env.PORT ?? 3000)

HttpRouter.serve(Routes).pipe(
  Layer.provide(LetzplayLive),
  Layer.provide(EzvizLive),
  Layer.provide(BunHttpServer.layer({ port })),
  Layer.launch,
  BunRuntime.runMain,
)
