import { useCallback, useEffect, useRef, useState } from "react"
import {
  buildGrid,
  cellAspect,
  clamp,
  gridSize,
  paint,
  type AnimMode,
  type BlendSettings,
  type Grid,
  type ToneSettings,
} from "@/lib/ascii-engine"
import { positionAt, totalDuration, type ClipTiming } from "@/lib/timeline"

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
const BASE_FONT = 14

export interface Source {
  img: HTMLImageElement
  w: number
  h: number
  name: string
}

/** One image on the timeline, with its own framing and timing. */
export interface Clip extends ClipTiming {
  id: string
  source: Source
  /** Size of this image inside the frame; 1 is the fitted size. */
  scale: number
}

export interface MotionSettings {
  mode: AnimMode
  /** Perturbation strength, 0..1. */
  amount: number
  fps: number
}

/** Frames in one loop, clamped so a long project can't run away. */
export const frameCountFor = (clips: ClipTiming[], fps: number) => clamp(Math.round(totalDuration(clips) * fps), 2, 600)

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

interface CacheEntry {
  cols: number
  rows: number
  frame: number | null
  scale: number
  src: Source
  rgba: Uint8ClampedArray
}

/** `ratio` is the frame's width / height; null keeps the first clip's own
 *  ratio. `playhead` (0..1) is what the preview shows while paused, so the
 *  stage always matches the clip you are working on. */
export function useAsciiArt(
  clips: Clip[],
  cols: number,
  lineHeight: number,
  tone: ToneSettings,
  motion: MotionSettings,
  playing: boolean,
  ratio: number | null,
  playhead: number,
  onPhase?: (phase: number) => void
) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [renderMs, setRenderMs] = useState(0)
  const sampleCanvas = useRef(document.createElement("canvas"))
  const metricCanvas = useRef(document.createElement("canvas"))
  const cache = useRef(new Map<string, CacheEntry>())

  // Mid-animation, every frame reads these refs rather than closing over
  // props -- a slider dragged while playing takes effect on the very next
  // frame instead of waiting for the animation loop to restart.
  const clipsRef = useRef(clips)
  const ratioRef = useRef(ratio)
  const colsRef = useRef(cols)
  const lineHeightRef = useRef(lineHeight)
  const toneRef = useRef(tone)
  const motionRef = useRef(motion)
  const onPhaseRef = useRef(onPhase)
  clipsRef.current = clips
  ratioRef.current = ratio
  colsRef.current = cols
  lineHeightRef.current = lineHeight
  toneRef.current = tone
  motionRef.current = motion
  onPhaseRef.current = onPhase

  /** Sample one clip into a cols x rows grid, cover-placed and edge-extended.
   *  Cached per clip, since only the clip being edited needs resampling. */
  const sampleClip = useCallback((clip: Clip, c: number, rows: number, ar: number, frame: number | null): Uint8ClampedArray => {
    const hit = cache.current.get(clip.id)
    if (hit && hit.cols === c && hit.rows === rows && hit.frame === frame && hit.scale === clip.scale && hit.src === clip.source) {
      return hit.rgba
    }
    const sc = sampleCanvas.current
    sc.width = c
    sc.height = rows
    const sctx = sc.getContext("2d", { willReadFrequently: true })!
    sctx.clearRect(0, 0, c, rows)
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = "high"
    let rgba: Uint8ClampedArray
    try {
      const placed = drawPlaced(sctx, clip.source, c, rows, ar, clip.scale)
      rgba = sctx.getImageData(0, 0, c, rows).data
      extendEdges(rgba, c, rows, placed)
    } catch {
      rgba = new Uint8ClampedArray(c * rows * 4)
    }
    cache.current.set(clip.id, { cols: c, rows, frame, scale: clip.scale, src: clip.source, rgba })
    return rgba
  }, [])

  /** Build the grid for one point on the timeline. */
  const buildAt = useCallback(
    (phase: number): Grid | null => {
      const list = clipsRef.current
      if (list.length === 0) return null
      const first = list[0].source
      const lineHeight = lineHeightRef.current
      const mctx = metricCanvas.current.getContext("2d")!
      const ar = cellAspect(mctx, FONT_FAMILY, lineHeight)
      const frame = ratioRef.current
      // The grid is sized from the first clip, so every other image is placed
      // into the same frame instead of resizing it.
      const { cols: c, rows } = gridSize(colsRef.current, first.w, first.h, ar, frame !== null, frame ?? 1, 1)

      const m = motionRef.current
      const frames = frameCountFor(list, m.fps)
      const pos = positionAt(list, phase)
      const clip = list[Math.min(pos.index, list.length - 1)]
      const rgba = sampleClip(clip, c, rows, ar, frame)

      let blend: BlendSettings | null = null
      if (pos.progress !== null && pos.next !== pos.index) {
        const to = list[pos.next]
        blend = {
          rgbaTo: sampleClip(to, c, rows, ar, frame),
          progress: pos.progress,
          mode: m.mode,
          step: Math.floor(phase * frames),
        }
      }

      // Each clip animates through its whole hold. Decode gets one complete
      // cycle per hold -- scramble, resolve, dissolve -- so an image reads as
      // "decoding itself" before it hands over; the continuous effects run off
      // the loop phase so they never jump at a clip boundary. During a
      // handover decode steps aside, because the handover is already
      // scrambling and the two would fight.
      let anim = null
      if (m.mode !== "none") {
        if (m.mode === "decode") {
          if (!blend) anim = { mode: m.mode, amount: m.amount, phase: pos.holdProgress, frameCount: frames }
        } else {
          anim = { mode: m.mode, amount: m.amount, phase, frameCount: frames }
        }
      }

      return buildGrid(rgba, c, rows, toneRef.current, anim, blend)
    },
    [sampleClip]
  )

  /** Build one frame without disturbing the live preview -- used by the GIF
   *  and MP4 exporters, which walk the loop offscreen. */
  const buildFrame = useCallback((phase: number) => buildAt(phase), [buildAt])

  const render = useCallback(
    (phase: number) => {
      const t0 = performance.now()
      const g = buildAt(phase)
      setGrid(g)
      if (g) setRenderMs(Math.round(performance.now() - t0))
    },
    [buildAt]
  )

  // Paused: show the playhead's frame, so the stage always matches the clip
  // being edited and scrubbing the timeline works.
  useEffect(() => {
    if (playing) return
    const id = requestAnimationFrame(() => render(playhead))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, cols, lineHeight, ratio, playhead, JSON.stringify(tone), motion.mode, motion.amount, playing, render])

  // Playing: advance the phase from wall-clock time at the target frame rate,
  // reporting it back so the timeline's playhead can follow.
  useEffect(() => {
    if (!playing || clips.length === 0) return
    let raf = 0
    let last = 0
    const total = Math.max(0.1, totalDuration(clipsRef.current))
    const t0 = performance.now() - playhead * total * 1000
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const interval = 1000 / motionRef.current.fps
      if (now - last < interval - 1) return
      last = now
      const loopMs = Math.max(100, totalDuration(clipsRef.current) * 1000)
      const phase = (((now - t0) % loopMs) / loopMs + 1) % 1
      onPhaseRef.current?.(phase)
      render(phase)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, motion.fps, render])

  const paintTo = useCallback(
    (canvas: HTMLCanvasElement, scale: number, paper: string, transparentBg: boolean, forceOpaque = false) => {
      if (!grid) return null
      return paint(canvas, grid, BASE_FONT * scale, lineHeight, FONT_FAMILY, paper, transparentBg, forceOpaque)
    },
    [grid, lineHeight]
  )

  return { grid, renderMs, paintTo, buildFrame, fontFamily: FONT_FAMILY, baseFont: BASE_FONT }
}
