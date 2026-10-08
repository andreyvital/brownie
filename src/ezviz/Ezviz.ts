import { Cache, Config, Context, Data, Duration, Effect, Exit, Layer, Option, Redacted } from "effect"

export class EzvizError extends Data.TaggedError("EzvizError")<{
  readonly message: string
}> {}

export interface AccessToken {
  readonly accessToken: string
  /** Regional API host the token is bound to, e.g. https://isaopen.ezvizlife.com */
  readonly areaDomain: string
  /** Epoch milliseconds */
  readonly expireTime: number
}

export class Ezviz extends Context.Service<
  Ezviz,
  {
    /** False when EZVIZ_APP_KEY / EZVIZ_APP_SECRET aren't set */
    readonly configured: boolean
    /** Open Platform access token for the player, refreshed before it expires */
    readonly token: Effect.Effect<AccessToken, EzvizError>
  }
>()("Ezviz") {}

// The global endpoint; the response says which regional host the account lives on
const TOKEN_URL = "https://open.ezvizlife.com/api/lapp/token/get"

const fetchToken = (appKey: string, appSecret: Redacted.Redacted<string>) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        body: new URLSearchParams({ appKey, appSecret: Redacted.value(appSecret) }),
      })
      return (await res.json()) as { code: string; msg: string; data?: AccessToken }
    },
    catch: (cause) => new EzvizError({ message: `token request failed: ${cause}` }),
  }).pipe(
    Effect.flatMap((body) =>
      body.code === "200" && body.data
        ? Effect.succeed(body.data)
        : Effect.fail(new EzvizError({ message: `token request rejected: ${body.code} ${body.msg}` })),
    ),
  )

export const EzvizLive = Layer.effect(
  Ezviz,
  Effect.gen(function* () {
    const appKey = yield* Config.option(Config.String("EZVIZ_APP_KEY"))
    const appSecret = yield* Config.option(Config.Redacted("EZVIZ_APP_SECRET"))

    if (Option.isNone(appKey) || Option.isNone(appSecret)) {
      return {
        configured: false,
        token: Effect.fail(new EzvizError({ message: "EZVIZ_APP_KEY / EZVIZ_APP_SECRET aren't set" })),
      }
    }

    // Tokens last about a week; drop ours an hour early so viewers never get a stale one
    const cache = yield* Cache.makeWith((_: "token") => fetchToken(appKey.value, appSecret.value), {
      capacity: 1,
      timeToLive: (exit) =>
        Exit.isSuccess(exit)
          ? Duration.millis(Math.max(0, exit.value.expireTime - Date.now() - 60 * 60 * 1000))
          : Duration.zero,
    })

    return { configured: true, token: Cache.get(cache, "token") }
  }),
)
