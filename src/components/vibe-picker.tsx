import { useRef, useState } from "react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
              "rounded-md border text-left overflow-hidden transition-colors",
              on ? "border-primary" : "border-border hover:border-input"
            )}
          >
            <span className="block h-[26px]" style={{ background: g }} />
            <span className={cn("block px-1.5 py-1 text-[10px] tracking-wide", on ? "text-primary" : "text-muted-foreground")}>
              {v.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Glyphs offered as one-click picks in the editor popover, roughly light to
 *  heavy so the row itself reads as a miniature ramp. */
const QUICK_GLYPHS = [" ", ".", ":", "-", "=", "+", "*", "%", "#", "@", "░", "▒", "▓", "█"]

export function ToneLadder({
  paper,
  stops,
  set,
  onEditChar,
}: {
  paper: string
  stops: string[]
  set: string[]
  /** Replace the glyph at one position in the active ramp. Omit to render the
   *  ladder read-only. */
  onEditChar?: (index: number, ch: string) => void
}) {
  const lut = buildLUT(paper, stops, 1)
  const max = 26
  const items =
    set.length <= max
      ? set.map((c, i) => ({ c, t: set.length === 1 ? 1 : i / (set.length - 1), idx: i }))
      : Array.from({ length: max }, (_, k) => {
          const t = k / (max - 1)
          const idx = Math.round(t * (set.length - 1))
          return { c: set[idx], t, idx }
        })

  return (
    <div className="flex items-end gap-2 rounded p-1.5" style={{ background: paper }}>
      {items.map(({ c, t, idx }, i) => {
        const col = lut[Math.round(t * 255)]
        const isSpace = c === " "
        const cell = (
          <div className="flex-1 min-w-0 flex flex-col justify-end gap-[3px]">
            <div
              className="h-3.5 text-[13px] leading-none text-center overflow-hidden whitespace-pre"
              style={{ color: isSpace ? "var(--color-dimmer)" : col }}
            >
              {isSpace ? "·" : c}
            </div>
            <div className="h-3.5 rounded-[1px]" style={{ background: col, opacity: isSpace ? 0.18 : 1 }} />
          </div>
        )

        if (!onEditChar) return <div key={i}>{cell}</div>

        return (
          <GlyphEditor
            key={i}
            index={idx}
            char={c}
            color={col}
            level={idx + 1}
            levels={set.length}
            onCommit={onEditChar}
          >
            <button
              type="button"
              className="flex-1 min-w-0 cursor-pointer rounded-sm outline-none transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Edit glyph for tone level ${idx + 1} of ${set.length}, currently ${isSpace ? "blank" : `"${c}"`}`}
            >
              {cell}
            </button>
          </GlyphEditor>
        )
      })}
    </div>
  )
}

function GlyphEditor({
  index,
  char,
  color,
  level,
  levels,
  onCommit,
  children,
}: {
  index: number
  char: string
  color: string
  level: number
  levels: number
  onCommit: (index: number, ch: string) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = (next: string) => {
    onCommit(index, next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[196px] p-3"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
      >
        <div className="mb-2.5 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>
            Level {level} <span className="text-annotation">of {levels}</span>
          </span>
          <span className="size-2.5 shrink-0 rounded-full ring-1 ring-border" style={{ background: color }} />
        </div>

        <Input
          ref={inputRef}
          value={char === " " ? "" : char}
          placeholder="space"
          maxLength={1}
          spellCheck={false}
          aria-label="Replacement glyph"
          className="h-10 text-center font-mono text-lg"
          onChange={(e) => {
            const v = e.target.value
            commit(v.length ? v.slice(-1) : " ")
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false)
          }}
        />

        <div className="mt-2.5 flex flex-wrap gap-1">
          {QUICK_GLYPHS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => commit(g)}
              aria-label={g === " " ? "Set to blank" : `Set to "${g}"`}
              className={cn(
                "flex size-6 items-center justify-center rounded border font-mono text-[12px] transition-colors",
                g === char ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-input hover:text-foreground"
              )}
            >
              {g === " " ? "·" : g}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
