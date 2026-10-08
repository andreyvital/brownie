// Sends a WhatsApp message from the bot account (linked as a device via Baileys)
//
//   bun run whatsapp "hello"
//
// The first run links the bot account: WHATSAPP_PHONE must be its number, and the script
// prints a pairing code to enter on that phone. The session is then kept in .whatsapp-auth/
import makeWASocket, { DisconnectReason, useMultiFileAuthState, type WASocket } from "@whiskeysockets/baileys"
import pino from "pino"

const AUTH_DIR = ".whatsapp-auth"

// libsignal (used by Baileys) dumps whole sessions, keys included, with console.info
console.info = () => {}

const digits = (value: string | undefined) => value?.replace(/\D/g, "") ?? ""

const text = process.argv.slice(2).join(" ").trim()
const to = digits(process.env.WHATSAPP_TO)
const phone = digits(process.env.WHATSAPP_PHONE)

if (!text || !to) {
  console.error('usage: WHATSAPP_TO=5511999999999 bun run whatsapp "message"')
  process.exit(1)
}

const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

// Resolves once the socket is open. Right after pairing WhatsApp closes the connection
// with "restart required", so in that case connect again with the new credentials
const connect = (): Promise<WASocket> =>
  new Promise((resolve, reject) => {
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
    })
    sock.ev.on("creds.update", saveCreds)

    let pairingRequested = false
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr && !pairingRequested) {
        pairingRequested = true
        if (!phone) return reject(new Error("not linked yet: set WHATSAPP_PHONE to the bot account's number"))
        const code = await sock.requestPairingCode(phone)
        console.log(`On the bot's phone: Linked devices → Link a device → Link with phone number instead`)
        console.log(`Pairing code: ${code.match(/.{1,4}/g)?.join("-")}`)
      }
      if (connection === "open") resolve(sock)
      if (connection === "close") {
        const status = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
        if (status === DisconnectReason.restartRequired) return resolve(connect())
        if (status === DisconnectReason.loggedOut) {
          return reject(new Error(`logged out: delete ${AUTH_DIR}/ and link again`))
        }
        reject(lastDisconnect?.error ?? new Error("connection closed"))
      }
    })
  })

const sock = await connect()

const [result] = (await sock.onWhatsApp(to)) ?? []
if (!result?.exists) {
  console.error(`${to} isn't on WhatsApp`)
  process.exit(1)
}

await sock.sendMessage(result.jid, { text })
console.log(`sent to ${to}`)

// Give the message a moment to leave before closing the socket
await Bun.sleep(2000)
sock.end(undefined)
process.exit(0)
