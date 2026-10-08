import { DisconnectReason, useMultiFileAuthState, type WASocket } from "@whiskeysockets/baileys"
import { Config, Context, Data, Effect, Layer } from "effect"
import { rm } from "node:fs/promises"
import { AUTH_DIR, digits, disconnectStatus, formatPairingCode, makeSocket } from "~/whatsapp/socket"

export class WhatsAppError extends Data.TaggedError("WhatsAppError")<{
  readonly message: string
}> {}

export type Status =
  /** Not linked to an account; asking for the status starts linking */
  | { readonly state: "unlinked" }
  | { readonly state: "connecting" }
  /** Waiting for the code to be entered on the account's phone */
  | { readonly state: "pairing"; readonly code: string }
  | { readonly state: "open" }
  /** Another device took over this session (e.g. the CLI script with the same files) */
  | { readonly state: "replaced" }

export class WhatsApp extends Context.Service<
  WhatsApp,
  {
    /** Where the connection stands. Starts linking when there's no session yet */
    readonly status: Effect.Effect<Status>
    /** Where the connection stands, without starting anything */
    readonly currentStatus: Effect.Effect<Status>
    readonly send: (phone: string, text: string) => Effect.Effect<void, WhatsAppError>
  }
>()("WhatsApp") {}

// When a connection drops, wait this long before connecting again
const RECONNECT_MS = 5_000

export const WhatsAppLive = Layer.effect(
  WhatsApp,
  Effect.gen(function* () {
    const phone = digits(yield* Config.String("WHATSAPP_PHONE").pipe(Config.withDefault("")))

    // Baileys is callback based, so its connection is plain mutable state here
    let status: Status = { state: "unlinked" }
    let sock: WASocket | undefined
    let stopped = false
    const log = (message: string) => Effect.runFork(Effect.logInfo(message))

    const connect = async () => {
      status = { state: "connecting" }
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
      const socket = makeSocket(state)
      sock = socket
      socket.ev.on("creds.update", saveCreds)

      let pairingRequested = false
      socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr && !pairingRequested) {
          pairingRequested = true
          if (!phone) {
            log("WhatsApp isn't linked and WHATSAPP_PHONE isn't set")
            return socket.end(undefined)
          }
          const code = formatPairingCode(await socket.requestPairingCode(phone))
          status = { state: "pairing", code }
          log(`WhatsApp pairing code for ${phone}: ${code}`)
        }
        if (connection === "open") {
          status = { state: "open" }
          log(`WhatsApp connected as ${socket.user?.id}`)
        }
        if (connection !== "close" || stopped) return

        sock = undefined
        const reason = disconnectStatus(lastDisconnect?.error)
        if (reason === DisconnectReason.restartRequired) return void connect()
        if (reason === DisconnectReason.connectionReplaced) {
          status = { state: "replaced" }
          return log("WhatsApp session was taken over by another device, not reconnecting")
        }
        if (reason === DisconnectReason.loggedOut) {
          // The session is useless now; drop it so the next visit can link again
          await rm(AUTH_DIR, { recursive: true, force: true })
          status = { state: "unlinked" }
          return log("WhatsApp logged out, session deleted")
        }
        if (state.creds.registered) {
          status = { state: "connecting" }
          setTimeout(() => void connect(), RECONNECT_MS)
          return
        }
        // Pairing code expired. Don't keep asking for new ones (each one notifies the
        // phone): wait until someone looks at the status again
        status = { state: "unlinked" }
      })
    }

    // Reconnect a linked session right away; an unlinked one waits until it's needed
    const { state } = yield* Effect.promise(() => useMultiFileAuthState(AUTH_DIR))
    if (state.creds.registered) void connect()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        stopped = true
        sock?.end(undefined)
      }),
    )

    const send = Effect.fn("WhatsApp.send")(function* (to: string, text: string) {
      const socket = sock
      if (status.state !== "open" || !socket) {
        return yield* new WhatsAppError({ message: `WhatsApp isn't connected (${status.state})` })
      }
      yield* Effect.tryPromise({
        try: async () => {
          const [result] = (await socket.onWhatsApp(to)) ?? []
          if (!result?.exists) throw new Error(`${to} isn't on WhatsApp`)
          await socket.sendMessage(result.jid, { text })
        },
        catch: (cause) => new WhatsAppError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      yield* Effect.logInfo(`WhatsApp message sent to ${to}`)
    })

    return WhatsApp.of({
      status: Effect.sync(() => {
        if (status.state === "unlinked") void connect()
        return status
      }),
      currentStatus: Effect.sync(() => status),
      send,
    })
  }),
)
