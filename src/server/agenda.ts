import type { Slot } from "~/letzplay/parse"

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const formatDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })

// "updated 14:32 (3 min ago)" in the club's timezone.
const formatFetchedAt = (fetchedAt: Date, timeZone: string) => {
  const time = fetchedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone })
  const minutes = Math.floor((Date.now() - fetchedAt.getTime()) / 60_000)
  return `updated ${time} (${minutes < 1 ? "just now" : `${minutes} min ago`})`
}

const renderSlot =(slot: Slot) => {
  const who =
    slot.scheduleId !== undefined
      ? `<span class="free">Free</span>`
      : slot.players.map((p) => `<span class="player">${escape(p.name)}</span>`).join("") ||
        `<span class="muted">Booked</span>`
  return `<li class="${slot.scheduleId !== undefined ? "slot is-free" : "slot"}">
  <div class="time">${slot.start}<span>${slot.end}</span></div>
  <div class="court">${escape(slot.court)}</div>
  <div class="who">${who}</div>
</li>`
}

export const renderAgenda = (opts: {
  club: string
  date: string
  today: string
  slots: ReadonlyArray<Slot>
  fetchedAt: Date
  timeZone: string
}) => {
  const { club, date, today, slots, fetchedAt, timeZone } = opts
  const sorted = [...slots]
    .filter((s) => s.date === date)
    .sort((a, b) => a.start.localeCompare(b.start) || a.court.localeCompare(b.court))
  const free = sorted.filter((s) => s.scheduleId !== undefined).length

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Court agenda · ${escape(club)}</title>
<style>
  :root {
    --bg: #f6f4ef; --card: #fff; --text: #1d1d1b; --muted: #77746c; --line: #e6e2d8;
    --accent: #c4501f; --free-bg: #e6f4e8; --free: #23743a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #151513; --card: #1e1e1b; --text: #ecebe6; --muted: #9a978e; --line: #2e2d29;
      --accent: #f07a45; --free-bg: #1d3323; --free: #7fd294;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  h1 { font-size: 22px; margin: 0; }
  nav a { color: var(--accent); text-decoration: none; padding: 6px 10px; border-radius: 8px; }
  nav a:hover { background: var(--card); }
  .summary { color: var(--muted); margin: 0 0 20px; }
  .summary a { color: var(--accent); }
  ul { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .slot { display: grid; grid-template-columns: 56px 1fr; grid-template-areas: "time court" "time who"; gap: 2px 12px; padding: 12px 16px; border-top: 1px solid var(--line); }
  .slot:first-child { border-top: 0; }
  .time { grid-area: time; font-weight: 600; font-variant-numeric: tabular-nums; }
  .time span { display: block; font-weight: 400; color: var(--muted); font-size: 13px; }
  .court { grid-area: court; color: var(--muted); font-size: 13px; }
  .who { grid-area: who; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  .free { color: var(--free); background: var(--free-bg); padding: 1px 8px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .muted, .empty { color: var(--muted); }
  .empty { padding: 32px 16px; text-align: center; }
  .updated { color: var(--muted); font-size: 13px; margin: 12px 0 0; text-align: center; }
</style>
</head>
<body>
<main>
  <header>
    <h1>${formatDate(date)}</h1>
    <nav><a href="/?date=${shiftDate(date, -1)}" aria-label="Previous day">‹</a><a href="/?date=${shiftDate(date, 1)}" aria-label="Next day">›</a></nav>
  </header>
  <p class="summary">${escape(club)} · ${sorted.length} slots, ${free} free${date === today ? "" : ` · <a href="/">today</a>`}</p>
  ${sorted.length > 0 ? `<ul>${sorted.map(renderSlot).join("")}</ul>` : `<ul><li class="empty">No slots listed for this day.</li></ul>`}
  <p class="updated">Data from letzplay.me, ${formatFetchedAt(fetchedAt, timeZone)}</p>
</main>
</body>
</html>`
}
