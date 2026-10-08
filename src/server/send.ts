import type { Status } from "~/whatsapp/WhatsApp"

export interface Contact {
  readonly name: string
  readonly phone: string
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const renderStatus = (status: Status) => {
  switch (status.state) {
    case "open":
      return `<p class="status ok">WhatsApp connected</p>`
    case "connecting":
      return `<p class="status">Connecting to WhatsApp…</p>`
    case "unlinked":
      return `<p class="status bad">WhatsApp isn't linked, and WHATSAPP_PHONE isn't set to link it</p>`
    case "replaced":
      return `<p class="status bad">Another device took over this WhatsApp session. Retrying for a couple of minutes; after that, redeploy</p>`
    case "pairing":
      return `<div class="status pairing">
  <p>Link the bot account: on its phone go to Linked devices → Link a device →
  Link with phone number instead, and enter</p>
  <p class="code">${escape(status.code)}</p>
</div>`
  }
}

export const renderSend = (opts: {
  contacts: ReadonlyArray<Contact>
  status: Status
  /** Outcome of the message just sent */
  result?: { ok: boolean; message: string }
  to?: string
  text?: string
}) => {
  const { contacts, status, result, to = contacts[0]?.name, text = "" } = opts
  // Until the connection settles, check again in a few seconds
  const refresh = status.state === "connecting" || status.state === "pairing" ? `<meta http-equiv="refresh" content="5">` : ""
  const options = contacts
    .map(
      (c) => `<label class="contact">
    <input type="radio" name="to" value="${escape(c.name)}"${c.name === to ? " checked" : ""}>
    <span>${escape(c.name)}</span>
  </label>`,
    )
    .join("\n  ")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>Send a WhatsApp message</title>
<style>
  :root { --bg: #f6f4ef; --card: #fff; --text: #1d1d1b; --muted: #77746c; --line: #e3dfd5;
    --accent: #c4501f; --ok: #2f7d4f; --bad: #b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #151513; --card: #1f1f1c; --text: #ecebe6; --muted: #9a978e; --line: #33322e;
      --accent: #f07a45; --ok: #6cc28f; --bad: #f2867e; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0; }
  a { color: var(--accent); text-decoration: none; }
  .status { color: var(--muted); margin: 0 0 16px; }
  .status.ok { color: var(--ok); }
  .status.bad, .result.bad { color: var(--bad); }
  .pairing { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; }
  .pairing p { margin: 0; }
  .code { font: 600 28px/1.3 ui-monospace, monospace; letter-spacing: 2px; color: var(--text); margin-top: 8px !important; }
  form { display: grid; gap: 12px; }
  .contacts { display: flex; gap: 8px; flex-wrap: wrap; }
  .contact span { display: inline-block; padding: 8px 16px; border: 1px solid var(--line); border-radius: 999px;
    background: var(--card); cursor: pointer; }
  .contact input { position: absolute; opacity: 0; }
  .contact input:checked + span { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .contact input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }
  textarea { width: 100%; min-height: 120px; padding: 12px; font: inherit; color: inherit; resize: vertical;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
  button { justify-self: start; padding: 10px 20px; font: inherit; font-weight: 600; color: #fff;
    background: var(--accent); border: 0; border-radius: 999px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .result { margin: 16px 0 0; color: var(--ok); }
</style>
</head>
<body>
<main>
  <header><h1>Send a WhatsApp message</h1><a href="/">Agenda</a></header>
  ${renderStatus(status)}
  <form method="post" action="/send">
    <div class="contacts">
  ${options}
    </div>
    <textarea name="text" required placeholder="Message">${escape(text)}</textarea>
    <button type="submit"${status.state === "open" ? "" : " disabled"}>Send</button>
  </form>
  ${result ? `<p class="result${result.ok ? "" : " bad"}">${escape(result.message)}</p>` : ""}
</main>
</body>
</html>`
}
