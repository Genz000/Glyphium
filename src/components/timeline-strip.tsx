import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Clip } from "@/hooks/use-ascii-art"
import { segmentsOf, totalDuration } from "@/lib/timeline"
import { cn } from "@/lib/utils"

/** The project laid out in time: every clip is a block as wide as it is long,
 *  with the handover to the next clip wedged between. Click a block to select
 *  and edit it; click or drag anywhere to scrub. */
export function TimelineStrip({
  clips,
  selectedId,
  phase,
  playing,
  effectLabel,
  onSelect,
  onSeek,
  onRemove,
  onAdd,
}: {
  clips: Clip[]
  selectedId: string | null
  phase: number
  playing: boolean
  effectLabel: string
  onSelect: (id: string) => void
  onSeek: (phase: number) => void
  onRemove: (id: string) => void
  onAdd: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const total = totalDuration(clips)
  const segments = segmentsOf(clips)

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el || total <= 0) return
      const r = el.getBoundingClientRect()
      onSeek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
    },
    [onSeek, total]
  )

  // Dragging continues outside the track, the way a scrubber should.
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => seekFromEvent(e.clientX)
    const up = () => setDragging(false)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [dragging, seekFromEvent])

  if (clips.length === 0) return null

  return (
    <div className="flex items-stretch gap-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          ref={trackRef}
          className="relative flex h-[46px] w-full cursor-ew-resize select-none overflow-hidden rounded-md border bg-muted/30"
          onPointerDown={(e) => {
            e.preventDefault()
            setDragging(true)
            seekFromEvent(e.clientX)
          }}
        >
          {segments.map((seg) => {
            const width = `${(seg.duration / total) * 100}%`
            const clip = clips[seg.index]
            if (seg.kind === "transition") {
              return (
                <Tooltip key={`t-${seg.index}`}>
                  <TooltipTrigger asChild>
                    <div
                      className="group/tr relative h-full shrink-0 border-x border-dashed border-input/70 bg-primary/10"
                      style={{ width }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        onSelect(clip.id)
                        setDragging(true)
                        seekFromEvent(e.clientX)
                      }}
                    >
                      {/* Two wedges crossing: what is leaving, what is arriving. */}
                      <div className="absolute inset-0 bg-gradient-to-r from-foreground/15 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-l from-primary/25 to-transparent" />
                      <span className="absolute inset-x-0 bottom-0.5 truncate text-center text-[8.5px] uppercase tracking-[0.1em] text-annotation">
                        {seg.duration.toFixed(1)}s
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {effectLabel} handover · {seg.duration.toFixed(1)}s
                  </TooltipContent>
                </Tooltip>
              )
            }
            const selected = clip.id === selectedId
            return (
              <div
                key={`h-${seg.index}`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`Clip ${seg.index + 1}, ${clip.source.name}`}
                className={cn(
                  "group/clip relative h-full shrink-0 overflow-hidden outline-none transition-colors",
                  selected ? "ring-2 ring-inset ring-primary" : "hover:bg-accent/40"
                )}
                style={{ width }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect(clip.id)
                  setDragging(true)
                  seekFromEvent(e.clientX)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect(clip.id)
                  }
                }}
              >
                <img
                  src={clip.source.img.src}
                  alt=""
                  className={cn("absolute inset-0 size-full object-cover transition-opacity", selected ? "opacity-45" : "opacity-25")}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/85 to-background/30" />
                <span className="absolute left-1.5 top-1 text-[9px] font-medium tabular-nums text-foreground/80">{seg.index + 1}</span>
                <span className="absolute inset-x-1.5 bottom-0.5 truncate text-center text-[9px] text-muted-foreground">
                  {clip.source.name}
                </span>
                {clips.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${clip.source.name}`}
                    className="absolute right-0.5 top-0.5 hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive group-hover/clip:block"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemove(clip.id)
                    }}
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Playhead */}
          <div
            className={cn("pointer-events-none absolute inset-y-0 w-px bg-primary", playing && "shadow-[0_0_6px_var(--primary)]")}
            style={{ left: `${Math.min(100, Math.max(0, phase * 100))}%` }}
          >
            <span className="absolute -top-px left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary" />
          </div>
        </div>

        <div className="flex items-center justify-between text-[9.5px] uppercase tracking-[0.14em] text-annotation">
          <span>
            {clips.length} {clips.length === 1 ? "clip" : "clips"} · {total.toFixed(1)}s loop
          </span>
          <span className="tabular-nums">{(phase * total).toFixed(1)}s</span>
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-sm" className="mt-[9px] shrink-0" onClick={onAdd} aria-label="Add an image">
            <Plus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add an image to the timeline</TooltipContent>
      </Tooltip>
    </div>
  )
}
