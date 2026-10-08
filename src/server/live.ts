import type { AccessToken } from "~/ezviz/Ezviz"

// JSON that's safe to drop inside a <script> element
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c")

export const renderLive = (opts: { serial: string; token: AccessToken }) => {
  const { serial, token } = opts
  const config = {
    url: `ezopen://open.ys7.com/${serial}/1.hd.live`,
    accessToken: token.accessToken,
    domain: token.areaDomain,
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live court camera</title>
<style>
  :root { --bg: #f6f4ef; --text: #1d1d1b; --muted: #77746c; --accent: #c4501f; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #151513; --text: #ecebe6; --muted: #9a978e; --accent: #f07a45; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0; }
  a { color: var(--accent); text-decoration: none; }
  #player { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 12px; overflow: hidden; }
</style>
</head>
<body>
<main>
  <header><h1>Live</h1><a href="/">Agenda</a></header>
  <div id="player"></div>
</main>
<script src="/ezuikit/ezuikit.js"></script>
<script>
  const config = ${scriptJson(config)};
  const el = document.getElementById("player");
  new EZUIKit.EZUIKitPlayer({
    id: "player",
    url: config.url,
    accessToken: config.accessToken,
    env: { domain: config.domain },
    staticPath: "/ezuikit/ezuikit_static",
    template: el.clientWidth < 600 ? "mobileLive" : "pcLive",
    width: el.clientWidth,
    height: el.clientHeight,
    audio: false,
  });
</script>
</body>
</html>`
}
