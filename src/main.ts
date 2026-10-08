import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Cache, Config, Duration, Effect, Exit, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { dirname, join, normalize } from "node:path"
import { Ezviz, EzvizLive } from "~/ezviz/Ezviz"
import { Letzplay, LetzplayLive } from "~/letzplay/Letzplay"
import { renderAgenda } from "~/server/agenda"
import { renderLive } from "~/server/live"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// The EZVIZ player loads its WASM decoders at runtime, so its package is served as-is
const EZUIKIT_DIR = dirname(Bun.resolveSync("ezuikit-js", import.meta.dir))

// YYYY-MM-DD for "now" in the club's timezone (servers usually run in UTC).
const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())

const Routes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter
    const letzplay = yield* Letzplay
    const ezviz = yield* Ezviz
    const camera = yield* Config.String("EZVIZ_CAMERA").pipe(Config.withDefault("BG5113153"))
    const club = yield* Config.String("LETZPLAY_CLUB").pipe(Config.withDefault("clavatenis"))
    const timeZone = yield* Config.String("CLUB_TIMEZONE").pipe(Config.withDefault("America/Sao_Paulo"))

    // Each scrape takes a couple of seconds, so keep a day's agenda for a few
    // minutes. Failures aren't cached.
    const agenda = yield* Cache.makeWith((date: string) => letzplay.listSlots({ date }), {
      capacity: 32,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.minutes(5) : Duration.zero),
    })

    yield* router.add("GET", "/health", HttpServerResponse.text("ok"))

    yield* router.add(
      "GET",
      "/live",
      ezviz.token.pipe(
        Effect.map((token) => HttpServerResponse.html(renderLive({ serial: camera, token }))),
        Effect.catch((error) =>
          Effect.logError("failed to get an EZVIZ token", error).pipe(
            Effect.as(
              HttpServerResponse.text(
                ezviz.configured ? "Couldn't reach EZVIZ, try again shortly." : "The live camera isn't set up yet.",
                { status: ezviz.configured ? 502 : 503 },
              ),
            ),
          ),
        ),
      ),
    )

    yield* router.add(
      "GET",
      "/ezuikit/*",
      Effect.gen(function* () {
        const params = yield* HttpRouter.params
        const rel = normalize(params["*"] ?? "")
        if (rel.startsWith("..") || !(rel === "ezuikit.js" || rel.startsWith("ezuikit_static/"))) {
          return HttpServerResponse.empty({ status: 404 })
        }
        return yield* HttpServerResponse.file(join(EZUIKIT_DIR, rel), {
          contentType: rel.endsWith(".wasm") ? "application/wasm" : undefined,
          headers: { "cache-control": "public, max-age=86400" },
        })
      }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 404 })))),
    )

    yield* router.add(
      "GET",
      "/",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const today = todayIn(timeZone)
        const param = new URL(request.url, "http://localhost").searchParams.get("date")
        const date = param && DATE_RE.test(param) ? param : today

        const slots = yield* Cache.get(agenda, date)
        return HttpServerResponse.html(renderAgenda({ club, date, today, slots }))
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
