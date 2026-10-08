// What the CLI script and the server's WhatsApp service share
import makeWASocket, { type AuthenticationState } from "@whiskeysockets/baileys"
import pino from "pino"

// On Railway this is on the volume (see Dockerfile and justfile)
export const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || ".whatsapp-auth"

// libsignal (used by Baileys) dumps whole sessions, keys included, with console.info.
// Effect logs through console.info too, so only drop libsignal's messages
const info = console.info
console.info = (...args: Array<unknown>) => {
  if (typeof args[0] === "string" && /^(Opening|Closing|Removing old closed|Migrating) session/.test(args[0])) return
  info(...args)
}

export const makeSocket = (auth: AuthenticationState) =>
  makeWASocket({ auth, logger: pino({ level: "silent" }), markOnlineOnConnect: false })

export const digits = (value: string | undefined) => value?.replace(/\D/g, "") ?? ""

// "BTYB5F1H" → "BTYB-5F1H", the way the phone shows it
export const formatPairingCode = (code: string) => code.match(/.{1,4}/g)?.join("-") ?? code

export const disconnectStatus = (error: unknown) =>
  (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
