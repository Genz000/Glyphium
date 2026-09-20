import { useCallback, useEffect, useRef, useState } from "react"
import {
  buildGrid,
  cellAspect,
  clamp,
  gridSize,
  paint,
  type AnimMode,
  type Grid,
  type ToneSettings,
} from "@/lib/ascii-engine"

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
const BASE_FONT = 14

export interface Source {
  img: HTMLImageElement
  w: number
  h: number
  name: string
}

export interface MotionSettings {
  mode: AnimMode
  /** Perturbation strength, 0..1. */
  amount: number
  /** Loop length in seconds. */
  duration: number
  fps: number
}

/** Frames in one loop, clamped the same way the standalone prototype did. */
export const frameCountFor = (m: Pick<MotionSettings, "duration" | "fps">) => clamp(Math.round(m.duration * m.fps), 2, 150)

/** The source flattened to a bitmap once, so it can be cropped. An SVG with no
 *  intrinsic size maps a drawImage source rectangle onto the wrong coordinate
 *  space, so cropping the <img> directly draws a sliver; cropping a canvas
 *  copy is exact. Vectors are rasterised at >= 1024px on the long side so the
 *  crop still has detail to sample. */
const rasters = new WeakMap<HTMLImageElement, HTMLCanvasElement>()
function rasterOf(src: Source): HTMLCanvasElement {
  let cv = rasters.get(src.img)
  if (!cv) {
    const k = Math.max(1, 1024 / Math.max(src.w, src.h))
    cv = document.createElement("canvas")
    cv.width = Math.round(src.w * k)
    cv.height = Math.round(src.h * k)
    const ctx = cv.getContext("2d")!
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(src.img, 0, 0, cv.width, cv.height)
    rasters.set(src.img, cv)
  }
  return cv
}

/** Place the whole source in a cols x rows sample grid. At scale 1 it's sized
 *  to cover the frame -- filling it edge to edge, overflow cropped, never
 *  letterboxed. Scale then grows or shrinks it about the centre: below 1 the
 *  cropped edges come back into view with paper around them, above 1 it zooms
 *  in. Grid cells aren't square, so sizes are worked out in pixel-aspect space
 *  (cellAr = cell width / height), not in raw cell counts. */
function drawPlaced(ctx: CanvasRenderingContext2D, src: Source, cols: number, rows: number, cellAr: number, scale: number) {
  const raster = rasterOf(src)
  const ia = raster.width / raster.height // image pixel aspect
  const P = (cols * cellAr) / rows // frame pixel aspect
  // In grid units an image w cols by h rows has pixel aspect w*cellAr/h.
  let w = cols
  let h = (cols * cellAr) / ia
  if (ia > P) {
    h = rows
    w = (rows * ia) / cellAr
  }
  w *= scale
  h *= scale
  const x = (cols - w) / 2
  const y = (rows - h) / 2
  ctx.drawImage(raster, x, y, w, h)
  return { x, y, w, h }
}

/** When the image is scaled below the frame, the margin around it would be
 *  empty -- transparent cells that get no glyphs and that motion skips. Carry
 *  the image's own edge out to the frame instead (clamp to edge): every margin
 *  cell copies the nearest pixel on the image's border, so the background
 *  continues seamlessly and the effect covers the whole frame. The image's own
 *  transparency is untouched -- a cut-out stays a cut-out. */
function extendEdges(rgba: Uint8ClampedArray, cols: number, rows: number, r: { x: number; y: number; w: number; h: number }) {
  // Innermost whole cells of the image; its outermost row/column is only
  // partly covered (anti-aliased), so it isn't a clean colour to repeat.
  const x0 = clamp(Math.ceil(r.x), 0, cols - 1)
  const y0 = clamp(Math.ceil(r.y), 0, rows - 1)
  const x1 = Math.max(x0, clamp(Math.floor(r.x + r.w) - 1, 0, cols - 1))
  const y1 = Math.max(y0, clamp(Math.floor(r.y + r.h) - 1, 0, rows - 1))
  if (x0 === 0 && y0 === 0 && x1 === cols - 1 && y1 === rows - 1) return // image already fills the frame
  for (let y = 0; y < rows; y++) {
    const sy = clamp(y, y0, y1)
    for (let x = 0; x < cols; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue
      const d = (y * cols + x) * 4
      const s = (sy * cols + clamp(x, x0, x1)) * 4
      rgba[d] = rgba[s]
      rgba[d + 1] = rgba[s + 1]
      rgba[d + 2] = rgba[s + 2]
      rgba[d + 3] = rgba[s + 3]
    }
  }
}

/** `ratio` is the frame's width / height; null keeps the source's own ratio.
 *  `scale` sizes the image within that frame; 1 is the fitted size. */
export function useAsciiArt(
  source: Source | null,
  cols: number,
  lineHeight: number,
  tone: ToneSettings,
  motion: MotionSettings,
  playing: boolean,
  ratio: number | null,
  scale: number
) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [renderMs, setRenderMs] = useState(0)
  const sampleCanvas = useRef(document.createElement("canvas"))
  const metricCanvas = useRef(document.createElement("canvas"))
  const cache = useRef<{ cols: number; rows: number; frame: number | null; scale: number; rgba: Uint8ClampedArray } | null>(null)

  // Mid-animation, every frame reads these refs rather than closing over
  // props -- a slider dragged while playing takes effect on the very next
  // frame instead of waiting for the animation loop to restart.
  const sourceRef = useRef(source)
  const ratioRef = useRef(ratio)
  const scaleRef = useRef(scale)
  const colsRef = useRef(cols)
  const lineHeightRef = useRef(lineHeight)
  const toneRef = useRef(tone)
  const motionRef = useRef(motion)
  sourceRef.current = source
  ratioRef.current = ratio
  scaleRef.current = scale
  colsRef.current = cols
  lineHeightRef.current = lineHeight
  toneRef.current = tone
  motionRef.current = motion

  useEffect(() => {
    cache.current = null
  }, [source, cols, lineHeight, ratio, scale])

  /** Sample the source (cached by grid size) and build one glyph grid. Pass a
   *  loop phase (0..1) while playing; pass null for a still frame -- motion is
   *  skipped entirely rather than perturbing at phase 0, so pausing or
   *  switching effects always lands back on the plain image. Stable identity
   *  -- reads everything live via refs so it never needs to be recreated. */
  const buildAt = useCallback((phase: number | null): Grid | null => {
    const source = sourceRef.current
    if (!source) return null
    const lineHeight = lineHeightRef.current
    const mctx = metricCanvas.current.getContext("2d")!
    const ar = cellAspect(mctx, FONT_FAMILY, lineHeight)
    const frame = ratioRef.current
    const fit = scaleRef.current
    const { cols: c, rows } = gridSize(colsRef.current, source.w, source.h, ar, frame !== null, frame ?? 1, 1)

    let rgba: Uint8ClampedArray
    if (cache.current && cache.current.cols === c && cache.current.rows === rows && cache.current.frame === frame && cache.current.scale === fit) {
      rgba = cache.current.rgba
    } else {
      const sc = sampleCanvas.current
      sc.width = c
      sc.height = rows
      const sctx = sc.getContext("2d", { willReadFrequently: true })!
      sctx.clearRect(0, 0, c, rows)
      sctx.imageSmoothingEnabled = true
      sctx.imageSmoothingQuality = "high"
      try {
        const placed = drawPlaced(sctx, source, c, rows, ar, fit)
        rgba = sctx.getImageData(0, 0, c, rows).data
        extendEdges(rgba, c, rows, placed)
      } catch {
        rgba = new Uint8ClampedArray(c * rows * 4)
      }
      cache.current = { cols: c, rows, frame, scale: fit, rgba }
    }

    const m = motionRef.current
    const anim = phase !== null && m.mode !== "none" ? { mode: m.mode, amount: m.amount, phase, frameCount: frameCountFor(m) } : null
    return buildGrid(rgba, c, rows, toneRef.current, anim)
  }, [])

  /** Build one frame of the loop without disturbing the live preview -- used
   *  by the GIF and MP4 exporters, which walk the loop offscreen. */
  const buildFrame = useCallback((phase: number) => buildAt(phase), [buildAt])

  const sampleAndBuild = useCallback(
    (phase: number | null) => {
      const t0 = performance.now()
      const g = buildAt(phase)
      setGrid(g)
      if (g) setRenderMs(Math.round(performance.now() - t0))
    },
    [buildAt]
  )

  // Still render: rebuild once whenever a setting actually changes, always at
  // a null (unperturbed) phase. Skipped while playing -- the animation loop
  // below owns rendering in that case, so this would otherwise fight it and
  // jump the preview back to phase 0. Reacts to motion.mode too, so picking a
  // different effect (or switching back to "none") while paused clears
  // whatever mid-loop frame was on screen instead of leaving it stuck.
  useEffect(() => {
    if (playing) return
    const id = requestAnimationFrame(() => sampleAndBuild(null))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, cols, lineHeight, ratio, scale, JSON.stringify(tone), motion.mode, playing, sampleAndBuild])

  // Animation loop: advances phase from wall-clock time (so pausing and
  // resuming stays in sync) and re-renders at the target frame rate. Reads
  // live tone/motion off the refs above, so tweaking a slider mid-loop is
  // reflected on the very next frame.
  useEffect(() => {
    if (!playing || motion.mode === "none") return
    let raf = 0
    let last = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const interval = 1000 / motionRef.current.fps
      if (now - last < interval - 1) return
      last = now
      const frames = frameCountFor(motionRef.current)
      const loopMs = (frames / motionRef.current.fps) * 1000
      sampleAndBuild(((now - t0) % loopMs) / loopMs)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, motion.mode, motion.duration, motion.fps, sampleAndBuild])

  const paintTo = useCallback(
    (canvas: HTMLCanvasElement, scale: number, paper: string, transparentBg: boolean, forceOpaque = false) => {
      if (!grid) return null
      return paint(canvas, grid, BASE_FONT * scale, lineHeight, FONT_FAMILY, paper, transparentBg, forceOpaque)
    },
    [grid, lineHeight]
  )

  return { grid, renderMs, paintTo, buildFrame, fontFamily: FONT_FAMILY, baseFont: BASE_FONT }
}
