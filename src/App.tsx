import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }

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
        showToast(`Saved PNG — ${cv.width} × ${cv.height}`)
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
    showToast(`Saved SVG — ${W} × ${H}`)
  }

  const copyText = async () => {
    if (!grid) return
    try {
      await navigator.clipboard.writeText(gridToText(grid))
      showToast(`Copied ${grid.rows} lines`)
    } catch {
      showToast("Clipboard blocked — save as SVG instead")
    }
  }

  return (
    <div className="grid h-dvh grid-cols-[336px_1fr] overflow-hidden max-md:h-auto max-md:grid-cols-1 max-md:overflow-auto">
      {/* ---------------------------------------------------------------- rail */}
      <aside className="flex min-h-0 flex-col border-r border-line bg-panel max-md:order-2 max-md:border-b max-md:border-r-0">
        <header className="border-b border-line px-5 pb-4 pt-5">
          <h1 className="font-display text-[22px] font-bold leading-none tracking-[-0.025em]">Glyphium</h1>
          <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-dimmer">Image &rarr; glyph converter</p>
        </header>

        <div className="scroller min-h-0 flex-1 overflow-y-auto max-md:overflow-visible">
          <Card className="rounded-none border-x-0 border-t-0">
            <CardHeader>Source <b className="font-normal text-dimmer">image / svg</b></CardHeader>
            <CardContent>
              <FileDrop
                fileName={source?.name ?? "no file loaded"}
                dims={source ? `${source.w} × ${source.h}` : "—"}
                onLoad={(img, name) => setSource({ img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, name })}
                onError={(msg) => showToast(`Couldn't open file — ${msg}`)}
              />
            </CardContent>
          </Card>

          <Card className="rounded-none border-x-0 border-t-0">
            <CardHeader>Grid <b className="font-normal text-dimmer">resolution</b></CardHeader>
            <CardContent>
              <FieldRow label="Columns" value={cols}>
                <Slider min={30} max={300} step={1} value={[cols]} onValueChange={([v]) => setCols(v)} />
              </FieldRow>
              <FieldRow label="Row spacing" value={lh.toFixed(2)}>
                <Slider min={0.75} max={1.6} step={0.01} value={[lh]} onValueChange={([v]) => setLh(v)} />
              </FieldRow>

              <div className="space-y-1.5">
                <Label>Character set</Label>
                <Select value={ramp} onValueChange={setRamp}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <input
                    className="w-full rounded border border-line bg-panel-2 px-2.5 py-2 text-[11.5px] focus:border-accent focus:outline-none"
                    value={customRamp}
                    spellCheck={false}
                    placeholder="light → heavy, e.g. .-+#"
                    onChange={(e) => setCustomRamp(e.target.value.length >= 2 ? e.target.value : " .-+#")}
                  />
                )}
              </div>

              <Options>
                <ToggleRow label="Edge glyphs" checked={edges} onCheckedChange={setEdges} />
                {edges && (
                  <FieldRow className="px-3 py-2.5" label="Edge sensitivity" value={edgeSensitivity.toFixed(2)}>
                    <Slider min={0.05} max={1} step={0.01} value={[edgeSensitivity]} onValueChange={([v]) => setEdgeSensitivity(v)} />
                  </FieldRow>
                )}
              </Options>
            </CardContent>
          </Card>

          <Card className="rounded-none border-x-0 border-t-0">
            <CardHeader>Tone <b className="font-normal text-dimmer">mapping</b></CardHeader>
            <CardContent>
              <FieldRow label="Brightness" value={(brightness > 0 ? "+" : "") + brightness.toFixed(2)}>
                <Slider min={-0.5} max={0.5} step={0.01} value={[brightness]} onValueChange={([v]) => setBrightness(v)} />
              </FieldRow>
              <FieldRow label="Contrast" value={contrast.toFixed(2)}>
                <Slider min={0.2} max={3} step={0.01} value={[contrast]} onValueChange={([v]) => setContrast(v)} />
              </FieldRow>
              <FieldRow label="Gamma" value={gamma.toFixed(2)}>
                <Slider min={0.35} max={2.6} step={0.01} value={[gamma]} onValueChange={([v]) => setGamma(v)} />
              </FieldRow>

              <div className="space-y-1.5">
                <Label>Dither</Label>
                <ToggleGroup type="single" value={dither} onValueChange={(v) => v && setDither(v as ToneSettings["dither"])}>
                  <ToggleGroupItem value="none">None</ToggleGroupItem>
                  <ToggleGroupItem value="ordered">Ordered</ToggleGroupItem>
                  <ToggleGroupItem value="diffuse">Diffusion</ToggleGroupItem>
                </ToggleGroup>
              </div>

              <Options>
                <ToggleRow label="Invert tones" checked={invert} onCheckedChange={setInvert} />
                <ToggleRow label="Keep transparency" checked={alphaKeep} onCheckedChange={setAlphaKeep} />
              </Options>
            </CardContent>
          </Card>

          <Card className="rounded-none border-x-0 border-t-0">
            <CardHeader>Colour <b className="font-normal text-dimmer">vibe</b></CardHeader>
            <CardContent>
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

              <FieldRow label="Ink strength" value={Math.round(inkStrength * 100) + "%"}>
                <Slider min={0.2} max={1} step={0.01} value={[inkStrength]} onValueChange={([v]) => setInkStrength(v)} />
              </FieldRow>

              <Options>
                <ToggleRow label="Keep source colours" checked={srcColor} onCheckedChange={setSrcColor} />
                {srcColor && (
                  <FieldRow className="px-3 py-2.5" label="Tint toward vibe" value={Math.round(mix * 100) + "%"}>
                    <Slider min={0} max={1} step={0.01} value={[mix]} onValueChange={([v]) => setMix(v)} />
                  </FieldRow>
                )}
                <ToggleRow label="Transparent background" checked={transparentBg} onCheckedChange={setTransparentBg} />
              </Options>
            </CardContent>
          </Card>
        </div>

        <div className="border-t border-line bg-panel px-5 pb-4 pt-3.5">
          <div className="mb-2 flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-dim">
            <span>Export</span>
            <span className="tabular-nums normal-case tracking-normal text-dimmer">
              {exportSize ? `${exportSize.w} × ${exportSize.h}` : "—"}
            </span>
          </div>
          <ToggleGroup type="single" value={String(scale)} onValueChange={(v) => v && setScale(Number(v))}>
            {[1, 2, 3, 4].map((s) => (
              <ToggleGroupItem key={s} value={String(s)}>{s}×</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Button className="col-span-2" onClick={savePNG}>Save PNG</Button>
            <Button variant="outline" onClick={saveSVG}>Save SVG</Button>
            <Button variant="outline" onClick={copyText}>Copy as text</Button>
          </div>
        </div>
      </aside>

      {/* --------------------------------------------------------------- stage */}
      <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-mat max-md:sticky max-md:top-0 max-md:z-10 max-md:order-1 max-md:h-[52dvh]">
        <div className="stage-ground" />

        <div className="relative flex min-h-0 flex-1 flex-col items-center gap-4 px-7 pb-5 pt-7 max-md:gap-2.5 max-md:px-5 max-md:pb-3 max-md:pt-5">
          <div ref={stageRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
            <div className="relative">
              <canvas
                ref={previewRef}
                className={cn("block ring-1 ring-line-strong", transparentBg && "alpha-grid")}
                aria-label={grid ? `ASCII render, ${grid.cols} by ${grid.rows} glyphs` : "No render"}
              />
              <span className="tick tick-tl" />
              <span className="tick tick-tr" />
              <span className="tick tick-bl" />
              <span className="tick tick-br" />
            </div>
          </div>

          {/* Plate margin -- the render is annotated where a proof would be. */}
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.15em]">
            <Ann label="file" value={source?.name ?? "none"} />
            <Ann label="source" value={source ? `${source.w}×${source.h}` : "—"} />
            <Ann label="grid" value={grid ? `${grid.cols}×${grid.rows}` : "—"} />
            <Ann label="glyphs" value={grid ? (grid.cols * grid.rows).toLocaleString() : "—"} />
            <Ann label="render" value={`${renderMs} ms`} />
          </div>
        </div>

        {/* Rendered even before the first grid exists, so the stage is measured
            against its final height and the plate does not reflow on load. */}
        <div className="relative shrink-0 border-t border-line bg-panel px-5 pb-3.5 pt-3 max-md:hidden">
          <div className="mx-auto flex min-h-[31px] max-w-[760px] items-center gap-4">
            <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-dim">Tone ramp</span>
            <div className="min-w-0 flex-1">
              {grid && <ToneLadder paper={paper} stops={stops} set={grid.set} />}
            </div>
          </div>
        </div>
      </main>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded border border-line-strong bg-panel-2 px-4 py-2.5 text-[11px] tracking-wide shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function Ann({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-dimmer">{label}</span>
      <b className="max-w-[22ch] truncate font-normal normal-case tracking-[0.06em] text-dim">{value}</b>
    </span>
  )
}

/** Boolean settings gathered into one block, so they read as a group instead of
 *  as more rows in the slider stack. */
function Options({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded border border-line bg-panel-2/50">{children}</div>
}

function FieldRow({
  label,
  value,
  children,
  className,
}: {
  label: string
  value: string | number
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-[10.5px] tracking-wide text-dim">
        <span>{label}</span>
        <var className="not-italic tabular-nums text-ink">{value}</var>
      </div>
      {children}
    </div>
  )
}

function ToggleRow({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2.5 px-3 py-2.5 text-[11.5px]">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded border border-line bg-panel-2 px-2 py-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-[22px] w-[22px] cursor-pointer rounded-sm border border-line-strong bg-transparent p-0"
      />
      <Label>{label}</Label>
    </div>
  )
}
