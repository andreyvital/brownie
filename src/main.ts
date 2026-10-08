import { BunRuntime } from "@effect/platform-bun"
import { Console, Effect } from "effect"
import { Letzplay, LetzplayLive, type SlotFilters } from "./Letzplay.ts"

// Usage: bun start [available|me|all] [YYYY-MM-DD]
const [filter = "available", date] = process.argv.slice(2)

const program = Effect.gen(function* () {
  const letzplay = yield* Letzplay
  const filters: SlotFilters = {
    filter: filter === "all" ? undefined : (filter as SlotFilters["filter"]),
    date,
  }
  const slots = yield* letzplay.listSlots(filters)

  for (const slot of slots) {
    const who = slot.players.length > 0 ? slot.players.map((p) => p.name).join(", ") : "—"
    const status = slot.scheduleId !== undefined ? `free (#${slot.scheduleId})` : who
    yield* Console.log(`${slot.date} ${slot.start}-${slot.end}  ${slot.court.padEnd(20)} ${status}`)
  }
  yield* Console.log(`\n${slots.length} slots`)
})

program.pipe(Effect.provide(LetzplayLive), BunRuntime.runMain)
