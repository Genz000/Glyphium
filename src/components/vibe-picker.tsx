import { VIBES, buildLUT, type Vibe } from "@/lib/ascii-engine"
import { cn } from "@/lib/utils"

export function VibePicker({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (v: Vibe) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {VIBES.map((v) => {
        const g =
          v.stops.length > 1
            ? `linear-gradient(90deg, ${v.paper} 0%, ${v.stops
                .map((c, i) => `${c} ${20 + i * (80 / (v.stops.length - 1))}%`)
                .join(", ")})`
            : `linear-gradient(90deg, ${v.paper}, ${v.stops[0]})`
        const on = v.id === selected
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v)}
            aria-pressed={on}
            className={cn(
              "rounded border text-left overflow-hidden transition-colors",
              on ? "border-accent" : "border-line hover:border-line-strong"
            )}
          >
            <span className="block h-[26px]" style={{ background: g }} />
            <span className={cn("block px-1.5 py-1 text-[10px] tracking-wide", on ? "text-accent" : "text-dim")}>
              {v.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ToneLadder({ paper, stops, set }: { paper: string; stops: string[]; set: string[] }) {
  const lut = buildLUT(paper, stops, 1)
  const max = 26
  const items =
    set.length <= max
      ? set.map((c, i) => [c, set.length === 1 ? 1 : i / (set.length - 1)] as const)
      : Array.from({ length: max }, (_, k) => {
          const t = k / (max - 1)
          return [set[Math.round(t * (set.length - 1))], t] as const
        })
  return (
    <div className="flex items-end gap-2 rounded p-1.5" style={{ background: paper }}>
      {items.map(([c, t], i) => {
        const col = lut[Math.round(t * 255)]
        const isSpace = c === " "
        return (
          <div key={i} className="flex-1 min-w-0 flex flex-col justify-end gap-[3px]">
            <div
              className="h-3.5 text-[13px] leading-none text-center overflow-hidden whitespace-pre"
              style={{ color: isSpace ? "var(--color-dimmer)" : col }}
            >
              {isSpace ? "·" : c}
            </div>
            <div className="h-3.5 rounded-[1px]" style={{ background: col, opacity: isSpace ? 0.18 : 1 }} />
          </div>
        )
      })}
    </div>
  )
}
