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

/** Draw the source into a cols x rows sample grid, center-cropped so it fills
 *  the whole frame -- no letterboxing. Grid cells aren't square, so the crop is
 *  worked out in pixel-aspect space (cellAspect), not in cell counts. */
function drawCover(ctx: CanvasRenderingContext2D, src: Source, cols: number, rows: number, cellAr: number) {
  const raster = rasterOf(src)
  const P = (cols * cellAr) / rows // pixel aspect of the whole grid
  const ia = raster.width / raster.height
  let sw = raster.width
  let sh = raster.height
  let sx = 0
  let sy = 0
  if (ia > P) {
    sw = raster.height * P
    sx = (raster.width - sw) / 2
  } else {
    sh = raster.width / P
    sy = (raster.height - sh) / 2
  }
  ctx.drawImage(raster, sx, sy, sw, sh, 0, 0, cols, rows)
}

/** `ratio` is the frame's width / height; null keeps the source's own ratio. */
export function useAsciiArt(
  source: Source | null,
  cols: number,
  lineHeight: number,
  tone: ToneSettings,
  motion: MotionSettings,
  playing: boolean,
  ratio: number | null
) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [renderMs, setRenderMs] = useState(0)
  const sampleCanvas = useRef(document.createElement("canvas"))
  const metricCanvas = useRef(document.createElement("canvas"))
  const cache = useRef<{ cols: number; rows: number; frame: number | null; rgba: Uint8ClampedArray } | null>(null)

  // Mid-animation, every frame reads these refs rather than closing over
  // props -- a slider dragged while playing takes effect on the very next
  // frame instead of waiting for the animation loop to restart.
  const sourceRef = useRef(source)
  const ratioRef = useRef(ratio)
  const colsRef = useRef(cols)
  const lineHeightRef = useRef(lineHeight)
  const toneRef = useRef(tone)
  const motionRef = useRef(motion)
  sourceRef.current = source
  ratioRef.current = ratio
  colsRef.current = cols
  lineHeightRef.current = lineHeight
  toneRef.current = tone
  motionRef.current = motion

  useEffect(() => {
    cache.current = null
  }, [source, cols, lineHeight, ratio])

  /** Sample the source (cached by grid size) and build one glyph grid. Pass a
   *  loop phase (0..1) while playing; pass null for a still frame -- motion is
   *  skipped entirely rather than perturbing at phase 0, so pausing or
   *  switching effects always lands back on the plain image. Stable identity
   *  -- reads everything live via refs so it never needs to be recreated. */
  const sampleAndBuild = useCallback((phase: number | null) => {
    const source = sourceRef.current
    if (!source) {
      setGrid(null)
      return
    }
    const t0 = performance.now()
    const lineHeight = lineHeightRef.current
    const mctx = metricCanvas.current.getContext("2d")!
    const ar = cellAspect(mctx, FONT_FAMILY, lineHeight)
    const frame = ratioRef.current
    const { cols: c, rows } = gridSize(colsRef.current, source.w, source.h, ar, frame !== null, frame ?? 1, 1)

    let rgba: Uint8ClampedArray
    if (cache.current && cache.current.cols === c && cache.current.rows === rows && cache.current.frame === frame) {
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
        if (frame === null) sctx.drawImage(source.img, 0, 0, c, rows)
        else drawCover(sctx, source, c, rows, ar)
        rgba = sctx.getImageData(0, 0, c, rows).data
      } catch {
        rgba = new Uint8ClampedArray(c * rows * 4)
      }
      cache.current = { cols: c, rows, frame, rgba }
    }

    const m = motionRef.current
    const anim = phase !== null && m.mode !== "none" ? { mode: m.mode, amount: m.amount, phase, frameCount: frameCountFor(m) } : null
    const g = buildGrid(rgba, c, rows, toneRef.current, anim)
    setGrid(g)
    setRenderMs(Math.round(performance.now() - t0))
  }, [])

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
  }, [source, cols, lineHeight, ratio, JSON.stringify(tone), motion.mode, playing, sampleAndBuild])

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

  return { grid, renderMs, paintTo, fontFamily: FONT_FAMILY, baseFont: BASE_FONT }
}
