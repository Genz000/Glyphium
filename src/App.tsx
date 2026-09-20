import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Pause, Play } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Toaster } from "@/components/ui/sonner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import { FileDrop } from "@/components/file-drop"
import { VibePicker, ToneLadder } from "@/components/vibe-picker"
import { frameCountFor, useAsciiArt, type Clip, type MotionSettings, type Source } from "@/hooks/use-ascii-art"
import { TimelineStrip } from "@/components/timeline-strip"
import { MIN_HOLD, MIN_TRANSITION, phaseOfClipStart, positionAt, totalDuration } from "@/lib/timeline"
import { clamp, gridToText, gridToSVG, paint, RAMPS, type AnimMode, type ToneSettings, type Vibe } from "@/lib/ascii-engine"
import { encodeGif } from "@/lib/gif-encoder"
import { encodeVideo } from "@/lib/video-encoder"
import { cn } from "@/lib/utils"

const DEMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
<defs>
 <radialGradient id="s" cx="34%" cy="28%" r="78%">
  <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#9a9aa8"/>
  <stop offset=".82" stop-color="#26262e"/><stop offset="1" stop-color="#0b0b0f"/>
 </radialGradient>
 <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#2a2a33"/><stop offset="1" stop-color="#050507"/>
 </linearGradient>
</defs>
<rect width="600" height="600" fill="url(#f)"/>
<ellipse cx="300" cy="512" rx="205" ry="34" fill="#000" opacity=".75"/>
<circle cx="300" cy="292" r="196" fill="url(#s)"/>
<circle cx="300" cy="292" r="196" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="2"/>
<path d="M110 470 Q300 386 490 470" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="3"/>
</svg>`

/** Offscreen canvas kept for text metrics only -- never painted, never mounted. */
let metricCanvas: HTMLCanvasElement | null = null

function measureCellWidth(fontPx: number, fontFamily: string) {
  metricCanvas ??= document.createElement("canvas")
  const ctx = metricCanvas.getContext("2d")!
  ctx.font = `500 ${fontPx}px ${fontFamily}`
  return ctx.measureText("M").width
}

/** Frame ratios for the stage. "source" keeps the image's own proportions;
 *  anything else crops the source to fill the new frame edge to edge. */
const FRAMES = [
  { id: "source", label: "Source", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
] as const

type FrameId = (typeof FRAMES)[number]["id"]

function download(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const FRAME_EFFECT_LABEL: Record<AnimMode, string> = {
  none: "Cut",
  shimmer: "Shimmer",
  decode: "Decode",
  wave: "Wave",
  rain: "Rain",
}

export default function App() {
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)

  // grid / font controls -- a narrow screen cannot resolve 150 columns, so the
  // opening resolution is matched to the viewport. The slider still goes to 300.
  const [cols, setCols] = useState(() => (window.innerWidth < 768 ? 80 : 150))
  const [lh, setLh] = useState(1)
  const [ramp, setRamp] = useState("standard")
  const [customRamp, setCustomRamp] = useState(" .-+#")
  const [edges, setEdges] = useState(false)
  const [edgeSensitivity, setEdgeSensitivity] = useState(0.35)

  // tone
  const [brightness, setBrightness] = useState(0)
  const [contrast, setContrast] = useState(1)
  const [gamma, setGamma] = useState(1)
  const [dither, setDither] = useState<ToneSettings["dither"]>("none")
  const [invert, setInvert] = useState(false)
  const [alphaKeep, setAlphaKeep] = useState(true)

  // vibe / colour
  const [vibeId, setVibeId] = useState<string | null>("bone")
  const [paper, setPaper] = useState("#0F0E13")
  const [stops, setStops] = useState<string[]>(["#4E4B59", "#E9E6DF"])
  const [srcColor, setSrcColor] = useState(false)
  const [mix, setMix] = useState(0)
  const [inkStrength, setInkStrength] = useState(1)
  const [transparentBg, setTransparentBg] = useState(false)

  // motion
  const [animMode, setAnimMode] = useState<AnimMode>("none")
  const [animAmount, setAnimAmount] = useState(0.45)
  const [fps, setFps] = useState(20)
  const [playing, setPlaying] = useState(false)
  const [outWidth, setOutWidth] = useState(720)
  const [loops, setLoops] = useState(2)
  const [exporting, setExporting] = useState<{ what: string; pct: number } | null>(null)

  const [scale, setScale] = useState(2)
  const [frameId, setFrameId] = useState<FrameId>("source")

  const frameRatio = FRAMES.find((f) => f.id === frameId)?.ratio ?? null

  const tone: ToneSettings = useMemo(
    () => ({
      ramp,
      customRamp,
      edges,
      edgeSensitivity,
      brightness,
      contrast,
      gamma,
      dither,
      invert,
      alphaKeep,
      paper,
      stops,
      srcColor,
      mix,
      inkStrength,
    }),
    [ramp, customRamp, edges, edgeSensitivity, brightness, contrast, gamma, dither, invert, alphaKeep, paper, stops, srcColor, mix, inkStrength]
  )

  const motion: MotionSettings = useMemo(
    () => ({ mode: animMode, amount: animAmount, fps }),
    [animMode, animAmount, fps]
  )
  const frameCount = frameCountFor(clips, fps)
  const loopSeconds = totalDuration(clips)
  const selected = clips.find((c) => c.id === selectedId) ?? clips[0] ?? null
  const selectedIndex = clips.findIndex((c) => c.id === selected?.id)
  /** Clip the playhead is sitting on -- what the stage is actually showing. */
  const liveIndex = clips.length ? positionAt(clips, playhead).index : -1

  const { grid, renderMs, paintTo, buildFrame, fontFamily, baseFont } = useAsciiArt(
    clips,
    cols,
    lh,
    tone,
    motion,
    playing,
    frameRatio,
    playhead,
    setPlayhead
  )
  const previewRef = useRef<HTMLCanvasElement>(null)
  const addFileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })

  /** Cell width at a given font size -- lets us size the plate without painting. */
  const cellWidth = useCallback((fontPx: number) => measureCellWidth(fontPx, fontFamily), [fontFamily])

  /** Natural size of the render at 1x, in CSS px. */
  const natural = useMemo(() => {
    if (!grid) return null
    return { w: cellWidth(baseFont) * grid.cols, h: baseFont * lh * grid.rows }
  }, [grid, lh, baseFont, cellWidth])

  /** Size of the exported file at the chosen scale. */
  const exportSize = useMemo(() => {
    if (!grid) return null
    return {
      w: Math.round(cellWidth(baseFont * scale) * grid.cols),
      h: Math.round(baseFont * scale * lh * grid.rows),
    }
  }, [grid, scale, lh, baseFont, cellWidth])

  // Track the space the plate may occupy.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      setStageBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Paint the preview at the scale it is actually displayed at, so the glyphs
  // stay crisp instead of being CSS-stretched.
  useEffect(() => {
    const cv = previewRef.current
    if (!cv || !grid || !natural || !stageBox.w || !stageBox.h) return
    const fit = Math.min(stageBox.w / natural.w, stageBox.h / natural.h)
    const dpr = window.devicePixelRatio || 1
    paintTo(cv, clamp(fit * dpr, 0.4, 4), paper, transparentBg)
    cv.style.width = `${Math.round(natural.w * fit)}px`
    cv.style.height = `${Math.round(natural.h * fit)}px`
  }, [grid, natural, paper, transparentBg, paintTo, stageBox])


  // Spacebar toggles playback, as long as focus isn't in a control that
  // itself uses the key (a text field, a focused slider thumb, a button).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || animMode === "none") return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || (el as HTMLElement)?.isContentEditable) return
      e.preventDefault()
      setPlaying((p) => !p)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [animMode])

  const newClip = (source: Source): Clip => ({
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source,
    scale: 1,
    hold: 2,
    transition: 0.6,
  })

  const addClip = (img: HTMLImageElement, name: string) => {
    const clip = newClip({ img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, name })
    setClips((list) => {
      const next = [...list, clip]
      // Jump the playhead to the clip just added, so it's what you see.
      setPlayhead(phaseOfClipStart(next, next.length - 1))
      return next
    })
    setSelectedId(clip.id)
    setPlaying(false)
  }

  const updateClip = (id: string, patch: Partial<Clip>) => setClips((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const removeClip = (id: string) => {
    setClips((list) => {
      if (list.length <= 1) return list
      const next = list.filter((c) => c.id !== id)
      const at = Math.min(list.findIndex((c) => c.id === id), next.length - 1)
      setSelectedId(next[at].id)
      setPlayhead(phaseOfClipStart(next, at))
      return next
    })
  }

  const moveClip = (id: string, dir: -1 | 1) => {
    setClips((list) => {
      const i = list.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      const tmp = next[i]
      next[i] = next[j]
      next[j] = tmp
      setPlayhead(phaseOfClipStart(next, j))
      return next
    })
  }

  const selectClip = (id: string) => {
    setSelectedId(id)
    if (!playing) {
      const i = clips.findIndex((c) => c.id === id)
      if (i >= 0) setPlayhead(phaseOfClipStart(clips, i))
    }
  }

  // boot: demo SVG. Guarded because StrictMode runs effects twice in dev, and
  // adding the demo twice would fake a two-clip project on first load.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(DEMO_SVG)
    const img = new Image()
    img.onload = () => addClip(img, "demo-sphere.svg")
    img.src = src
  }, [])

  const selectVibe = (v: Vibe) => {
    setVibeId(v.id)
    setPaper(v.paper)
    setStops(v.stops)
  }

  /** Retype one glyph in the active ramp without touching the rest of it.
   *  A preset ramp is read-only as a string, so the first edit forks it into
   *  the custom ramp -- the sidebar's character-set select follows along. */
  const editRampChar = (index: number, ch: string) => {
    const active = ramp === "custom" ? customRamp : RAMPS[ramp]
    const chars = Array.from(active)
    if (index < 0 || index >= chars.length) return
    chars[index] = ch
    setCustomRamp(chars.join(""))
    if (ramp !== "custom") setRamp("custom")
  }

  const baseName = () => (clips[0]?.source.name.replace(/.[^.]+$/, "") || "glyphium") + "-ascii"

  const savePNG = () => {
    if (!grid) return
    const cv = document.createElement("canvas")
    paintTo(cv, scale, paper, transparentBg)
    cv.toBlob((b) => {
      if (b) {
        download(b, `${baseName()}@${scale}x.png`)
        toast.success("Saved PNG", { description: `${cv.width} × ${cv.height} px at ${scale}×` })
      }
    }, "image/png")
  }

  /** Renders the loop offscreen at a fixed pixel size. Dimensions are forced
   *  even because H.264 encodes in 2x2 chroma blocks and rejects odd sizes. */
  const frameRenderer = (frames: number, targetW: number) => {
    const probe = buildFrame(0)
    if (!probe) throw new Error("nothing to render")
    const fontPx = (baseFont * targetW) / (cellWidth(baseFont) * probe.cols)
    const w = Math.max(2, Math.round(cellWidth(fontPx) * probe.cols))
    const h = Math.max(2, Math.round(fontPx * lh * probe.rows))
    const W = w - (w % 2)
    const H = h - (h % 2)
    const tmp = document.createElement("canvas")
    const out = document.createElement("canvas")
    out.width = W
    out.height = H
    const ctx = out.getContext("2d", { willReadFrequently: true })!
    const draw = (i: number) => {
      const g = buildFrame((i % frames) / frames)
      if (g) {
        // Always opaque: neither MP4 nor a delta-coded GIF carries alpha.
        paint(tmp, g, fontPx, lh, fontFamily, paper, false, true)
        ctx.drawImage(tmp, 0, 0)
      }
      return out
    }
    return { W, H, draw, ctx }
  }

  const runExport = async (what: string, job: (report: (done: number, total: number) => void) => Promise<void>) => {
    if (!grid) return
    if (animMode === "none") {
      toast.error("No motion to save", { description: "Choose a motion effect first." })
      return
    }
    setPlaying(false)
    setExporting({ what, pct: 0 })
    try {
      await job((done, total) => setExporting({ what, pct: Math.round((done / total) * 100) }))
    } catch (e) {
      toast.error(`${what} export failed`, { description: e instanceof Error ? e.message : "unknown error" })
    } finally {
      setExporting(null)
    }
  }

  const saveGIF = () =>
    runExport("GIF", async (report) => {
      const frames = frameCount
      const r = frameRenderer(frames, outWidth)
      const { blob, colors } = await encodeGif({
        width: r.W,
        height: r.H,
        frames,
        delayCs: Math.max(2, Math.round(100 / fps)),
        maxColors: 64,
        paper,
        renderFrame: (i) => {
          r.draw(i)
          return r.ctx.getImageData(0, 0, r.W, r.H).data
        },
        onProgress: report,
      })
      download(blob, `${baseName()}.gif`)
      toast.success("Saved GIF", {
        description: `${r.W} × ${r.H} · ${frames} frames · ${colors} colours · ${(blob.size / 1048576).toFixed(1)} MB`,
      })
    })

  const saveVideo = () =>
    runExport("MP4", async (report) => {
      const frames = frameCount
      const r = frameRenderer(frames, outWidth)
      const { blob, ext } = await encodeVideo({
        width: r.W,
        height: r.H,
        frames: frames * loops,
        fps,
        renderFrame: (i) => r.draw(i),
        onProgress: report,
      })
      download(blob, `${baseName()}.${ext}`)
      toast.success(`Saved ${ext.toUpperCase()}`, {
        description: `${r.W} × ${r.H} · ${((frames * loops) / fps).toFixed(1)} s · ${(blob.size / 1048576).toFixed(1)} MB`,
      })
    })

  const saveSVG = () => {
    if (!grid) return
    const fontPx = baseFont * scale
    const cw = cellWidth(fontPx)
    const chh = fontPx * lh
    const W = Math.round(cw * grid.cols)
    const H = Math.round(chh * grid.rows)
    const svg = gridToSVG(grid, fontPx, lh, fontFamily, paper, transparentBg, cw, W, H)
    download(new Blob([svg], { type: "image/svg+xml" }), `${baseName()}.svg`)
    toast.success("Saved SVG", { description: `${W} × ${H} px, editable text` })
  }

  const copyText = async () => {
    if (!grid) return
    try {
      await navigator.clipboard.writeText(gridToText(grid))
      toast.success("Copied as text", { description: `${grid.rows} lines on the clipboard` })
    } catch {
      toast.error("Clipboard blocked", { description: "Save as SVG to keep the text instead." })
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      {/* Stage first in the DOM as well as on screen, so reading and tab order
          both run left to right: wordmark, render, then the controls. */}
      <div className="grid h-dvh grid-cols-[1fr_336px] overflow-hidden max-md:h-auto max-md:grid-cols-1 max-md:overflow-auto">
        {/* ------------------------------------------------------------- stage */}
        <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-mat max-md:sticky max-md:top-0 max-md:z-10 max-md:h-[52dvh]">
          <div className="stage-ground" />

          <div className="relative flex min-h-0 flex-1 flex-col gap-4 px-7 pb-5 pt-6 max-md:gap-2.5 max-md:px-5 max-md:pb-3 max-md:pt-4">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
              {/* The maker's mark, printed on the mount board. */}
              <header>
                <h1 className="font-display text-[22px] font-bold leading-none tracking-[-0.025em] max-md:text-[19px]">
                  Glyphium
                </h1>
                <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-annotation max-md:mt-1.5">
                  Image &rarr; glyph converter
                </p>
              </header>

              {/* Frame ratio. Anything but Source crops the image to fill the new
                  frame edge to edge, so the effect covers the whole of it. */}
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] uppercase tracking-[0.18em] text-annotation max-md:hidden">Frame</span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={frameId}
                  onValueChange={(v) => v && setFrameId(v as FrameId)}
                  aria-label="Frame ratio"
                  className="bg-card/60 backdrop-blur-sm"
                >
                  {FRAMES.map((f) => (
                    <ToggleGroupItem key={f.id} value={f.id} className="h-7 px-2.5 text-[10.5px] tabular-nums">
                      {f.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <div ref={stageRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
              <div className="relative">
                <canvas
                  ref={previewRef}
                  className={cn("block ring-1 ring-input", transparentBg && "alpha-grid")}
                  aria-label={grid ? `ASCII render, ${grid.cols} by ${grid.rows} glyphs` : "No render"}
                />
                <span className="tick tick-tl" />
                <span className="tick tick-tr" />
                <span className="tick tick-bl" />
                <span className="tick tick-br" />

                {animMode !== "none" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        className="absolute bottom-2.5 right-2.5 bg-card/90 backdrop-blur-sm"
                        onClick={() => setPlaying((p) => !p)}
                        aria-label={playing ? "Pause animation" : "Play animation"}
                      >
                        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{playing ? "Pause" : "Play"} — space</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* The project in time: clips, handovers and the playhead. */}
            {clips.length > 0 && (
              <div className="shrink-0 max-md:hidden">
                <TimelineStrip
                  clips={clips}
                  selectedId={selected?.id ?? null}
                  phase={playhead}
                  playing={playing}
                  effectLabel={FRAME_EFFECT_LABEL[animMode]}
                  onSelect={selectClip}
                  onSeek={(p) => {
                    setPlaying(false)
                    setPlayhead(p)
                  }}
                  onRemove={removeClip}
                  onAdd={() => addFileRef.current?.click()}
                />
              </div>
            )}

            {/* Plate margin -- the render is annotated where a proof would be. */}
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] uppercase tracking-[0.15em]">
              <Ann label="file" value={clips[liveIndex]?.source.name ?? "none"} />
              <Ann
                label="source"
                value={clips[liveIndex] ? `${clips[liveIndex].source.w}×${clips[liveIndex].source.h}` : "—"}
              />
              <Ann label="frame" value={frameId === "source" ? "as source" : frameId} />
              <Ann label="grid" value={grid ? `${grid.cols}×${grid.rows}` : "—"} />
              <Ann label="glyphs" value={grid ? (grid.cols * grid.rows).toLocaleString() : "—"} />
              <Ann label="render" value={`${renderMs} ms`} />
              <Badge variant="outline" className="border-border px-2 py-0 text-[9.5px] uppercase tracking-[0.14em] text-annotation">
                {srcColor ? "source colours" : "gradient ink"}
              </Badge>
            </div>
          </div>

          {/* Rendered even before the first grid exists, so the stage is measured
              against its final height and the plate does not reflow on load. */}
          <div className="relative shrink-0 border-t bg-card px-5 pb-3.5 pt-3 max-md:hidden">
            <div className="mx-auto flex min-h-[31px] max-w-[760px] items-center gap-4">
              <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Tone ramp <span className="normal-case tracking-normal text-annotation">— click a glyph to retype it</span>
              </span>
              <div className="min-w-0 flex-1">
                {grid && <ToneLadder paper={paper} stops={stops} set={grid.set} onEditChar={editRampChar} />}
              </div>
            </div>
          </div>
        </main>

        {/* -------------------------------------------------------------- rail */}
        <aside className="flex min-h-0 flex-col border-l bg-card max-md:border-b max-md:border-l-0">
          <ScrollArea className="min-h-0 flex-1 max-md:h-auto">
            <Section title="Images" meta="timeline">
              <FileDrop
                fileName="drop to add a clip"
                dims={clips.length ? `${clips.length} on the timeline` : "—"}
                onLoad={(img, name) => addClip(img, name)}
                onError={(msg) => toast.error("Couldn't open that file", { description: msg })}
              />
              <p className="text-[10px] leading-relaxed text-annotation">
                Every image you add becomes a clip on the timeline under the preview. Each one animates for its own hold, then hands
                over to the next in the effect's pattern.
              </p>
            </Section>

            {/* Everything here applies to the selected clip only -- selecting
                one also moves the playhead to it, so the stage shows what you
                are editing. */}
            {selected && (
              <Section
                title={`Clip ${selectedIndex + 1}`}
                meta={clips.length > 1 ? `of ${clips.length}` : "selected"}
              >
                <div className="flex items-center gap-2.5">
                  <img
                    src={selected.source.img.src}
                    alt=""
                    className="size-10 shrink-0 rounded border object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px]">{selected.source.name}</div>
                    <div className="text-[10px] text-annotation">
                      {selected.source.w} × {selected.source.h}
                    </div>
                  </div>
                  {liveIndex !== selectedIndex && !playing && (
                    <Badge variant="outline" className="shrink-0 border-border px-1.5 py-0 text-[9px] uppercase text-annotation">
                      off playhead
                    </Badge>
                  )}
                </div>

                <Control id="clip-scale" label="Scale in frame" value={Math.round(selected.scale * 100) + "%"}>
                  <Slider
                    id="clip-scale"
                    min={0.1}
                    max={3}
                    step={0.01}
                    value={[selected.scale]}
                    onValueChange={([v]) => updateClip(selected.id, { scale: v })}
                  />
                </Control>
                {selected.scale !== 1 && (
                  <div className="-mt-1.5 flex justify-end">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-[10.5px] text-muted-foreground"
                      onClick={() => updateClip(selected.id, { scale: 1 })}
                    >
                      Reset to fit
                    </Button>
                  </div>
                )}

                <Control id="clip-hold" label="Hold" value={selected.hold.toFixed(1) + " s"}>
                  <Slider
                    id="clip-hold"
                    min={MIN_HOLD}
                    max={8}
                    step={0.1}
                    value={[selected.hold]}
                    onValueChange={([v]) => updateClip(selected.id, { hold: v })}
                  />
                </Control>

                {clips.length > 1 && (
                  <Control id="clip-cross" label={`Handover to ${selectedIndex + 2 > clips.length ? 1 : selectedIndex + 2}`} value={selected.transition.toFixed(1) + " s"}>
                    <Slider
                      id="clip-cross"
                      min={MIN_TRANSITION}
                      max={4}
                      step={0.1}
                      value={[selected.transition]}
                      onValueChange={([v]) => updateClip(selected.id, { transition: v })}
                    />
                  </Control>
                )}

                {clips.length > 1 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <Button size="sm" variant="outline" disabled={selectedIndex <= 0} onClick={() => moveClip(selected.id, -1)}>
                      ← Move
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectedIndex >= clips.length - 1}
                      onClick={() => moveClip(selected.id, 1)}
                    >
                      Move →
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => removeClip(selected.id)}>
                      Remove
                    </Button>
                  </div>
                )}
              </Section>
            )}

            <Section title="Grid" meta="resolution">
              <Control id="cols" label="Columns" value={cols}>
                <Slider id="cols" min={30} max={300} step={1} value={[cols]} onValueChange={([v]) => setCols(v)} />
              </Control>
              <Control id="rowspace" label="Row spacing" value={lh.toFixed(2)}>
                <Slider id="rowspace" min={0.75} max={1.6} step={0.01} value={[lh]} onValueChange={([v]) => setLh(v)} />
              </Control>

              <div className="space-y-1.5">
                <Label htmlFor="ramp" className="text-[11px] font-normal text-muted-foreground">Character set</Label>
                <Select value={ramp} onValueChange={setRamp}>
                  <SelectTrigger id="ramp" size="sm" className="w-full text-[11.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard — .:-=+*#%@</SelectItem>
                    <SelectItem value="detailed">Detailed — 68 steps</SelectItem>
                    <SelectItem value="blocks">Blocks — ░▒▓█</SelectItem>
                    <SelectItem value="minimal">Minimal — .*#</SelectItem>
                    <SelectItem value="dots">Dots — .:*oO0@</SelectItem>
                    <SelectItem value="type">Typewriter</SelectItem>
                    <SelectItem value="binary">Binary — 01</SelectItem>
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {ramp === "custom" && (
                  <Input
                    className="h-8 text-[11.5px]"
                    value={customRamp}
                    spellCheck={false}
                    aria-label="Custom character ramp"
                    placeholder="light → heavy, e.g. .-+#"
                    onChange={(e) => setCustomRamp(e.target.value.length >= 2 ? e.target.value : " .-+#")}
                  />
                )}
              </div>

              <Options>
                <ToggleRow id="edges" label="Edge glyphs" checked={edges} onCheckedChange={setEdges} />
                {edges && (
                  <Control id="edge-sens" label="Edge sensitivity" value={edgeSensitivity.toFixed(2)} className="px-3 py-2.5">
                    <Slider id="edge-sens" min={0.05} max={1} step={0.01} value={[edgeSensitivity]} onValueChange={([v]) => setEdgeSensitivity(v)} />
                  </Control>
                )}
              </Options>
            </Section>

            <Section title="Tone" meta="mapping">
              <Control id="brightness" label="Brightness" value={(brightness > 0 ? "+" : "") + brightness.toFixed(2)}>
                <Slider id="brightness" min={-0.5} max={0.5} step={0.01} value={[brightness]} onValueChange={([v]) => setBrightness(v)} />
              </Control>
              <Control id="contrast" label="Contrast" value={contrast.toFixed(2)}>
                <Slider id="contrast" min={0.2} max={3} step={0.01} value={[contrast]} onValueChange={([v]) => setContrast(v)} />
              </Control>
              <Control id="gamma" label="Gamma" value={gamma.toFixed(2)}>
                <Slider id="gamma" min={0.35} max={2.6} step={0.01} value={[gamma]} onValueChange={([v]) => setGamma(v)} />
              </Control>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-normal text-muted-foreground">Dither</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={dither}
                  onValueChange={(v) => v && setDither(v as ToneSettings["dither"])}
                  className="w-full"
                >
                  <ToggleGroupItem value="none" className="flex-1 text-[11px]">None</ToggleGroupItem>
                  <ToggleGroupItem value="ordered" className="flex-1 text-[11px]">Ordered</ToggleGroupItem>
                  <ToggleGroupItem value="diffuse" className="flex-1 text-[11px]">Diffusion</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <Options>
                <ToggleRow id="invert" label="Invert tones" checked={invert} onCheckedChange={setInvert} />
                <ToggleRow id="alpha" label="Keep transparency" checked={alphaKeep} onCheckedChange={setAlphaKeep} />
              </Options>
            </Section>

            <Section title="Colour" meta="vibe">
              <VibePicker selected={vibeId} onSelect={selectVibe} />

              <div className="grid grid-cols-2 gap-2">
                <ColorField label="Paper" value={paper} onChange={(v) => { setPaper(v); setVibeId(null) }} />
                <ColorField
                  label="Ink"
                  value={stops[stops.length - 1]}
                  onChange={(v) => {
                    setStops(stops.length > 1 ? [stops[0], v] : [v])
                    setVibeId(null)
                  }}
                />
              </div>

              <Control id="ink" label="Ink strength" value={Math.round(inkStrength * 100) + "%"}>
                <Slider id="ink" min={0.2} max={1} step={0.01} value={[inkStrength]} onValueChange={([v]) => setInkStrength(v)} />
              </Control>

              <Options>
                <ToggleRow id="srccolor" label="Keep source colours" checked={srcColor} onCheckedChange={setSrcColor} />
                {srcColor && (
                  <Control id="mix" label="Tint toward vibe" value={Math.round(mix * 100) + "%"} className="px-3 py-2.5">
                    <Slider id="mix" min={0} max={1} step={0.01} value={[mix]} onValueChange={([v]) => setMix(v)} />
                  </Control>
                )}
                <ToggleRow id="transparent" label="Transparent background" checked={transparentBg} onCheckedChange={setTransparentBg} />
              </Options>
            </Section>

            <Section title="Motion" meta="animated glyphs">
              <div className="space-y-1.5">
                <Label htmlFor="anim-mode" className="text-[11px] font-normal text-muted-foreground">Effect</Label>
                <Select
                  value={animMode}
                  onValueChange={(v) => {
                    setAnimMode(v as AnimMode)
                    if (v === "none") setPlaying(false) // nothing to play -- don't leave a stale Pause button
                  }}
                >
                  <SelectTrigger id="anim-mode" size="sm" className="w-full text-[11.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None — still image</SelectItem>
                    <SelectItem value="shimmer">Shimmer — glyphs breathe in place</SelectItem>
                    <SelectItem value="decode">Decode — scramble, then resolve</SelectItem>
                    <SelectItem value="wave">Wave — tone sweeps across</SelectItem>
                    <SelectItem value="rain">Rain — columns fall</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {animMode !== "none" && (
                <>
                  <Control id="anim-amt" label="Amount" value={Math.round(animAmount * 100) + "%"}>
                    <Slider id="anim-amt" min={0.05} max={1} step={0.01} value={[animAmount]} onValueChange={([v]) => setAnimAmount(v)} />
                  </Control>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-normal text-muted-foreground">Frame rate</Label>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={String(fps)}
                      onValueChange={(v) => v && setFps(Number(v))}
                      className="w-full"
                    >
                      {[10, 12, 20, 25].map((f) => (
                        <ToggleGroupItem key={f} value={String(f)} className="flex-1 text-[11px]">
                          {f}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>

                  <Button size="sm" variant={playing ? "default" : "outline"} className="w-full gap-1.5" onClick={() => setPlaying((p) => !p)}>
                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                    {playing ? "Pause animation" : "Play animation"}
                  </Button>
                  <p className="text-center text-[10px] text-annotation">
                    {frameCount} frames · {loopSeconds.toFixed(1)} s loop · {fps} fps
                    {clips.length > 1 ? ` · ${clips.length} clips` : ""}
                  </p>

                  <Separator />

                  {/* Save the loop as a file. GIF plays anywhere; MP4 (H.264)
                      is what social platforms want. */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="out-width" className="text-[11px] font-normal text-muted-foreground">Width</Label>
                      <Select value={String(outWidth)} onValueChange={(v) => setOutWidth(Number(v))}>
                        <SelectTrigger id="out-width" size="sm" className="w-full text-[11.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[480, 720, 1080, 1440].map((w) => (
                            <SelectItem key={w} value={String(w)}>{w} px</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="out-loops" className="text-[11px] font-normal text-muted-foreground">Video repeats</Label>
                      <Select value={String(loops)} onValueChange={(v) => setLoops(Number(v))}>
                        <SelectTrigger id="out-loops" size="sm" className="w-full text-[11.5px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 6].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}× — {(loopSeconds * n).toFixed(1)} s
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={saveGIF} disabled={!grid || exporting !== null}>
                          {exporting?.what === "GIF" ? `GIF ${exporting.pct}%` : "Save GIF"}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Loops forever, plays anywhere</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" onClick={saveVideo} disabled={!grid || exporting !== null}>
                          {exporting?.what === "MP4" ? `MP4 ${exporting.pct}%` : "Save MP4"}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>H.264 — for social media</TooltipContent>
                    </Tooltip>
                  </div>
                </>
              )}
            </Section>
          </ScrollArea>

          <div className="border-t bg-card px-5 pb-4 pt-3.5">
            <div className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Export</span>
              <span className="tabular-nums normal-case tracking-normal text-annotation">
                {exportSize ? `${exportSize.w} × ${exportSize.h}` : "—"}
              </span>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={String(scale)}
              onValueChange={(v) => v && setScale(Number(v))}
              className="w-full"
            >
              {[1, 2, 3, 4].map((s) => (
                <ToggleGroupItem key={s} value={String(s)} className="flex-1 text-[11px]">
                  {s}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button size="sm" className="col-span-2" onClick={savePNG} disabled={!grid}>
                Save PNG
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={saveSVG} disabled={!grid}>
                    Save SVG
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Vector file with real, editable text</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={copyText} disabled={!grid}>
                    Copy as text
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Plain glyphs, no colour</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </aside>
      </div>

      <input
        ref={addFileRef}
        type="file"
        hidden
        accept="image/*,.svg,.png,.jpg,.jpeg,.webp,.gif"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          const url = URL.createObjectURL(file)
          const img = new Image()
          img.onload = () => addClip(img, file.name)
          img.onerror = () => toast.error("Couldn't open that file", { description: "unsupported or damaged image" })
          img.src = url
        }}
      />

      <Toaster position="bottom-right" toastOptions={{ className: "font-mono text-[11.5px]" }} />
    </TooltipProvider>
  )
}

/** A rail section. Collapsible so a long control stack can be folded down to
 *  the parts you are actually working on. */
function Section({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <Collapsible defaultOpen className="border-b">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-5 py-3.5 text-[10px] uppercase tracking-[0.18em] outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="text-muted-foreground">{title}</span>
        <span className="text-annotation">{meta}</span>
        <ChevronDown className="ml-auto size-3.5 shrink-0 text-annotation transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="space-y-3.5 px-5 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Ann({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-annotation">{label}</span>
      <b className="max-w-[22ch] truncate font-normal normal-case tracking-[0.06em] text-muted-foreground">{value}</b>
    </span>
  )
}

/** Boolean settings gathered into one block, so they read as a group instead of
 *  as more rows in the slider stack. */
function Options({ children }: { children: ReactNode }) {
  return <div className="divide-y rounded-md border bg-muted/40">{children}</div>
}

function Control({
  id,
  label,
  value,
  children,
  className,
}: {
  id: string
  label: string
  value: string | number
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-[11px] font-normal text-muted-foreground">
          {label}
        </Label>
        <output htmlFor={id} className="text-[11px] tabular-nums text-foreground">
          {value}
        </output>
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2.5 px-3 py-2.5">
      <Label htmlFor={id} className="cursor-pointer text-[11.5px] font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `colour-${label.toLowerCase()}`
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-[22px] cursor-pointer rounded-sm border border-input bg-transparent p-0"
      />
      <Label htmlFor={id} className="cursor-pointer text-[11px] font-normal text-muted-foreground">
        {label}
      </Label>
    </div>
  )
}
