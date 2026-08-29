import { useCallback, useEffect, useRef, useState } from "react"
import {
  buildGrid,
  cellAspect,
  gridSize,
  paint,
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

export function useAsciiArt(source: Source | null, cols: number, lineHeight: number, tone: ToneSettings) {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [renderMs, setRenderMs] = useState(0)
  const sampleCanvas = useRef(document.createElement("canvas"))
  const metricCanvas = useRef(document.createElement("canvas"))
  const cache = useRef<{ cols: number; rows: number; rgba: Uint8ClampedArray } | null>(null)

  const rebuild = useCallback(() => {
    if (!source) {
      setGrid(null)
      return
    }
    const t0 = performance.now()
    const mctx = metricCanvas.current.getContext("2d")!
    const ar = cellAspect(mctx, FONT_FAMILY, lineHeight)
    const { cols: c, rows } = gridSize(cols, source.w, source.h, ar, false, 0, 0)

    let rgba: Uint8ClampedArray
    if (cache.current && cache.current.cols === c && cache.current.rows === rows) {
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
        sctx.drawImage(source.img, 0, 0, c, rows)
        rgba = sctx.getImageData(0, 0, c, rows).data
      } catch {
        rgba = new Uint8ClampedArray(c * rows * 4)
      }
      cache.current = { cols: c, rows, rgba }
    }

    const g = buildGrid(rgba, c, rows, tone)
    setGrid(g)
    setRenderMs(Math.round(performance.now() - t0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, cols, lineHeight, JSON.stringify(tone)])

  useEffect(() => {
    cache.current = null
  }, [source, cols, lineHeight])

  useEffect(() => {
    const id = requestAnimationFrame(rebuild)
    return () => cancelAnimationFrame(id)
  }, [rebuild])

  const paintTo = useCallback(
    (canvas: HTMLCanvasElement, scale: number, paper: string, transparentBg: boolean, forceOpaque = false) => {
      if (!grid) return null
      return paint(canvas, grid, BASE_FONT * scale, lineHeight, FONT_FAMILY, paper, transparentBg, forceOpaque)
    },
    [grid, lineHeight]
  )

  return { grid, renderMs, paintTo, fontFamily: FONT_FAMILY, baseFont: BASE_FONT }
}
