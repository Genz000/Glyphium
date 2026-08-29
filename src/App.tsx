import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Toaster } from "@/components/ui/sonner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import { FileDrop } from "@/components/file-drop"
import { VibePicker, ToneLadder } from "@/components/vibe-picker"
import { useAsciiArt, type Source } from "@/hooks/use-ascii-art"
import { clamp, gridToText, gridToSVG, type ToneSettings, type Vibe } from "@/lib/ascii-engine"
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

function download(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function App() {
  const [source, setSource] = useState<Source | null>(null)

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

  const [scale, setScale] = useState(2)

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

  const { grid, renderMs, paintTo, fontFamily, baseFont } = useAsciiArt(source, cols, lh, tone)
  const previewRef = useRef<HTMLCanvasElement>(null)
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

  // boot: demo SVG
  useEffect(() => {
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(DEMO_SVG)
    const img = new Image()
    img.onload = () => setSource({ img, w: img.naturalWidth, h: img.naturalHeight, name: "demo-sphere.svg" })
    img.src = src
  }, [])

  const selectVibe = (v: Vibe) => {
    setVibeId(v.id)
    setPaper(v.paper)
    setStops(v.stops)
  }

  const baseName = () => (source?.name.replace(/\.[^.]+$/, "") || "glyphium") + "-ascii"

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
      <div className="grid h-dvh grid-cols-[336px_1fr] overflow-hidden max-md:h-auto max-md:grid-cols-1 max-md:overflow-auto">
        {/* -------------------------------------------------------------- rail */}
        <aside className="flex min-h-0 flex-col border-r bg-card max-md:order-2 max-md:border-r-0 max-md:border-b">
          <header className="border-b px-5 pb-4 pt-5">
            <h1 className="font-display text-[22px] font-bold leading-none tracking-[-0.025em]">Glyphium</h1>
            <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-annotation">Image &rarr; glyph converter</p>
          </header>

          <ScrollArea className="min-h-0 flex-1 max-md:h-auto">
            <Section title="Source" meta="image / svg">
              <FileDrop
                fileName={source?.name ?? "no file loaded"}
                dims={source ? `${source.w} × ${source.h}` : "—"}
                onLoad={(img, name) => setSource({ img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, name })}
                onError={(msg) => toast.error("Couldn't open that file", { description: msg })}
              />
            </Section>

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

        {/* ------------------------------------------------------------- stage */}
        <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-mat max-md:sticky max-md:top-0 max-md:z-10 max-md:order-1 max-md:h-[52dvh]">
          <div className="stage-ground" />

          <div className="relative flex min-h-0 flex-1 flex-col items-center gap-4 px-7 pb-5 pt-7 max-md:gap-2.5 max-md:px-5 max-md:pb-3 max-md:pt-5">
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
              </div>
            </div>

            {/* Plate margin -- the render is annotated where a proof would be. */}
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] uppercase tracking-[0.15em]">
              <Ann label="file" value={source?.name ?? "none"} />
              <Ann label="source" value={source ? `${source.w}×${source.h}` : "—"} />
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
              <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Tone ramp</span>
              <div className="min-w-0 flex-1">
                {grid && <ToneLadder paper={paper} stops={stops} set={grid.set} />}
              </div>
            </div>
          </div>
        </main>
      </div>

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
