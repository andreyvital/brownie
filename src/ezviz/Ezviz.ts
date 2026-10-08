import { Cache, Config, Context, Data, Duration, Effect, Exit, Layer, Option, Redacted, Ref } from "effect"

export class EzvizError extends Data.TaggedError("EzvizError")<{
  readonly message: string
}> {}

export interface Snapshot {
  readonly image: Uint8Array
  readonly contentType: string
  readonly takenAt: Date
}

export class Ezviz extends Context.Service<
  Ezviz,
  {
    /** False when EZVIZ_EMAIL / EZVIZ_PASSWORD aren't set */
    readonly configured: boolean
    /** A recent picture from the camera, at most SNAPSHOT_TTL old */
    readonly snapshot: Effect.Effect<Snapshot, EzvizError>
  }
>()("Ezviz") {}

// Every viewer's refresh would otherwise ask the camera for a new picture
const SNAPSHOT_TTL = Duration.seconds(30)

// The consumer API the EZVIZ app uses. Unlike the Open Platform, it can see cameras
// shared with the account, which is how this one reaches us
const LOGIN_HOST = "apiieu.ezvizlife.com"

// EZVIZ treats each featureCode as a separate phone, and may ask for an e-mailed
// code the first time it sees one, so keep it fixed
const HEADERS = {
  featureCode: "8a3f4bfa36e7d2b1c0e95d6f4a7c21b9",
  clientType: "3",
  clientNo: "web_site",
  appId: "ys7",
  customno: "1000001",
  netType: "WIFI",
  language: "en_GB",
  lang: "en",
  "User-Agent": "okhttp/3.12.1",
}

interface Session {
  readonly sessionId: string
  readonly apiDomain: string
}

type Meta = { meta?: { code: number; message?: string } }

const md5 = (s: string) => new Bun.CryptoHasher("md5").update(s).digest("hex")

const request = <A>(what: string, url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init.headers } })
      return { status: res.status, body: (await res.json()) as A & Meta }
    },
    catch: (cause) => new EzvizError({ message: `${what} failed: ${cause}` }),
  })

const login = Effect.fn("ezviz.login")(function* (email: string, password: Redacted.Redacted<string>) {
  let host = LOGIN_HOST
  // The first answer may just say which regional host the account lives on
  for (let attempt = 0; attempt < 2; attempt++) {
    const { body } = yield* request<{
      loginSession?: { sessionId: string }
      loginArea?: { apiDomain: string }
    }>("login", `https://${host}/v3/users/login/v5`, {
      method: "POST",
      body: new URLSearchParams({
        account: email,
        password: md5(Redacted.value(password)),
        featureCode: HEADERS.featureCode,
        msgType: "0",
        bizType: "",
        cuName: "YnJvd25pZQ==",
      }),
    })
    const code = body.meta?.code
    if (code === 200 && body.loginSession && body.loginArea) {
      yield* Effect.logInfo(`logged into EZVIZ as ${email}`)
      return { sessionId: body.loginSession.sessionId, apiDomain: body.loginArea.apiDomain } satisfies Session
    }
    if (code === 1100 && body.loginArea) {
      host = body.loginArea.apiDomain
      continue
    }
    if (code === 6002) {
      return yield* new EzvizError({ message: "EZVIZ wants a verification code for this new login, see README" })
    }
    return yield* new EzvizError({ message: `login rejected: ${code} ${body.meta?.message ?? ""}` })
  }
  return yield* new EzvizError({ message: "login kept being redirected to another region" })
})

export const EzvizLive = Layer.effect(
  Ezviz,
  Effect.gen(function* () {
    const email = yield* Config.option(Config.String("EZVIZ_EMAIL"))
    const password = yield* Config.option(Config.Redacted("EZVIZ_PASSWORD"))
    const camera = yield* Config.String("EZVIZ_CAMERA").pipe(Config.withDefault("BG5113153"))

    if (Option.isNone(email) || Option.isNone(password)) {
      return {
        configured: false,
        snapshot: Effect.fail(new EzvizError({ message: "EZVIZ_EMAIL / EZVIZ_PASSWORD aren't set" })),
      }
    }

    // Log in lazily and keep the session until EZVIZ rejects it
    const session = yield* Ref.make(Option.none<Session>())
    const currentSession = Effect.gen(function* () {
      const cached = yield* Ref.get(session)
      if (Option.isSome(cached)) return cached.value
      const fresh = yield* login(email.value, password.value)
      yield* Ref.set(session, Option.some(fresh))
      return fresh
    })

    const capture = Effect.gen(function* () {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { sessionId, apiDomain } = yield* currentSession
        const { status, body } = yield* request<{ captureInfo?: { picUrl: string } }>(
          "capture",
          `https://${apiDomain}/v3/devconfig/v1/${camera}/1/capture`,
          { method: "PUT", headers: { sessionId } },
        )
        if (status === 401 || body.meta?.code === 401) {
          yield* Effect.logInfo("EZVIZ session expired")
          yield* Ref.set(session, Option.none())
          continue
        }
        if (body.meta?.code !== 200 || !body.captureInfo) {
          return yield* new EzvizError({ message: `capture rejected: ${body.meta?.code} ${body.meta?.message ?? ""}` })
        }
        return body.captureInfo.picUrl
      }
      return yield* new EzvizError({ message: "EZVIZ kept rejecting a fresh session" })
    })

    const download = (url: string) =>
      Effect.tryPromise({
        try: async () => {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const type = res.headers.get("content-type") ?? ""
          return {
            image: new Uint8Array(await res.arrayBuffer()),
            contentType: type.startsWith("image/") ? type : "image/jpeg",
            takenAt: new Date(),
          } satisfies Snapshot
        },
        catch: (cause) => new EzvizError({ message: `snapshot download failed: ${cause}` }),
      })

    const cache = yield* Cache.makeWith((_: "snapshot") => capture.pipe(Effect.flatMap(download)), {
      capacity: 1,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? SNAPSHOT_TTL : Duration.zero),
    })

    return { configured: true, snapshot: Cache.get(cache, "snapshot") }
  }),
)
