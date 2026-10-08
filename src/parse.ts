import { parse, type HTMLElement } from "node-html-parser"

export interface Player {
  readonly name: string
  readonly handle: string
}

export interface Slot {
  /** Present when the slot can be booked ("Agendar"). */
  readonly scheduleId: number | undefined
  readonly date: string // YYYY-MM-DD
  readonly start: string // HH:mm
  readonly end: string // HH:mm
  readonly court: string
  readonly players: ReadonlyArray<Player>
}

export interface SlotPage {
  readonly slots: ReadonlyArray<Slot>
  readonly hasNextPage: boolean
}

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
}

// "Qui, 08/Out - 11:00 às 12:30"
const SLOT_RE = /(\d{2})\/(\w{3})\s*-\s*(\d{2}:\d{2})\s*às\s*(\d{2}:\d{2})/

// The page omits the year; pick the one that puts the date closest to today.
const resolveDate = (day: number, month: number, today: Date) => {
  const year = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]
    .map((y) => ({ y, diff: Math.abs(new Date(y, month - 1, day).getTime() - today.getTime()) }))
    .sort((a, b) => a.diff - b.diff)[0]!.y
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

const parseSlot = (row: HTMLElement, today: Date): Slot | undefined => {
  const info = row.querySelector(".col-md-4")
  const match = info?.textContent.match(SLOT_RE)
  const month = match && MONTHS[match[2]!.toLowerCase()]
  if (!match || !month) return undefined

  const id = row.querySelector("a.club-schedule")?.getAttribute("data-schedule-id")
  return {
    scheduleId: id ? Number(id) : undefined,
    date: resolveDate(Number(match[1]), month, today),
    start: match[3]!,
    end: match[4]!,
    court: info!.querySelector(".text-muted")?.textContent.trim() ?? "",
    players: row.querySelectorAll(".media-body").map((p) => ({
      name: p.querySelector("span.text-overflow")?.textContent.trim() ?? "",
      handle: p.querySelector("a")?.textContent.trim() ?? "",
    })),
  }
}

export const parseSlotPage = (html: string, today = new Date()): SlotPage => {
  const root = parse(html)
  return {
    slots: root
      .querySelectorAll(".striped-content .striped-line")
      .flatMap((row) => parseSlot(row, today) ?? []),
    hasNextPage: root.querySelector(".pagination li.next a") !== null,
  }
}
