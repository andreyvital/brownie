// The picture refreshes itself; the server keeps one for 30s, so polling faster gains nothing
const REFRESH_SECONDS = 30

export const renderLive = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Court camera</title>
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
  img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #000; border-radius: 12px; }
  p { color: var(--muted); margin: 8px 0 0; }
</style>
</head>
<body>
<main>
  <header><h1>Court camera</h1><a href="/">Agenda</a></header>
  <img id="snapshot" src="/live.jpg" alt="Latest picture of the courts">
  <p id="status">Refreshes every ${REFRESH_SECONDS} seconds</p>
</main>
<script>
  const img = document.getElementById("snapshot");
  const status = document.getElementById("status");
  img.onerror = () => { status.textContent = "Couldn't get a picture from the camera, retrying…"; };
  img.onload = () => { status.textContent = "Updated " + new Date().toLocaleTimeString() + ", refreshes every ${REFRESH_SECONDS} seconds"; };
  setInterval(() => {
    if (!document.hidden) img.src = "/live.jpg?t=" + Date.now();
  }, ${REFRESH_SECONDS * 1000});
</script>
</body>
</html>`
