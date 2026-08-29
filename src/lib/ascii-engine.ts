// Core ASCII conversion engine. Pure functions, no DOM globals beyond
// canvas -- ported from the standalone Glyphworks HTML prototype so behaviour
// stays identical while the UI moves to React + shadcn.

export const RAMPS: Record<string, string> = {
  standard: " .:-=+*#%@",
  detailed: " .`'^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  minimal: " .*#",
  dots: " .:*oO0@",
  type: " .,;!vlLFE$",
  binary: " .01",
}

export interface Vibe {
  id: string
  name: string
  paper: string
  stops: string[]
}

export const VIBES: Vibe[] = [
  { id: "bone", name: "Bone", paper: "#0F0E13", stops: ["#4E4B59", "#E9E6DF"] },
  { id: "terminal", name: "Terminal", paper: "#04140B", stops: ["#186E42", "#7BFFB0"] },
  { id: "amber", name: "Amber", paper: "#140A02", stops: ["#8A4B00", "#FFC24D"] },
  { id: "newsprint", name: "Newsprint", paper: "#F1EEE6", stops: ["#9A9488", "#14120F"] },
  { id: "blueprint", name: "Blueprint", paper: "#061B2E", stops: ["#1E5F86", "#9EE0FF"] },
  { id: "uv", name: "Ultraviolet", paper: "#0C0616", stops: ["#4B21B8", "#C6A6FF", "#FFE1F5"] },
  { id: "ember", name: "Ember", paper: "#150402", stops: ["#7A1B08", "#FF5A1F", "#FFD08A"] },
  { id: "riso", name: "Riso", paper: "#0D0B14", stops: ["#2B6BFF", "#FF3EA5", "#FFE86B"] },
  { id: "lagoon", name: "Lagoon", paper: "#03161A", stops: ["#0E6E7A", "#5FE0D0"] },
  { id: "goldleaf", name: "Gold leaf", paper: "#100E08", stops: ["#6B5417", "#E3B341", "#FFF3C4"] },
]

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export function hex2rgb(h: string): [number, number, number] {
  h = h.replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgb2hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0")).join("")

function stopsAt(stops: string[], t: number): [number, number, number] {
  t = clamp(t, 0, 1)
  if (stops.length === 1) return hex2rgb(stops[0])
  const x = t * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2)
  const f = x - i
  const a = hex2rgb(stops[i])
  const b = hex2rgb(stops[i + 1])
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}
const lumOf = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

export interface ToneSettings {
  ramp: string
  customRamp: string
  edges: boolean
  edgeSensitivity: number
  brightness: number
  contrast: number
  gamma: number
  dither: "none" | "ordered" | "diffuse"
  invert: boolean
  alphaKeep: boolean
  paper: string
  stops: string[]
  srcColor: boolean
  mix: number
  inkStrength: number
}

export interface Grid {
  cols: number
  rows: number
  ch: string[]
  col: (string | null)[]
  set: string[]
}

export type AnimMode = "none" | "shimmer" | "decode" | "wave" | "rain"

export interface AnimSettings {
  mode: AnimMode
  /** Perturbation strength, 0..1. */
  amount: number
  /** Loop position, 0..1 -- every effect is periodic in phase so a full loop
   *  tiles seamlessly back to its start. */
  phase: number
  /** Frames per loop, only consulted by "decode" (glyphs re-scramble once per
   *  frame rather than continuously). */
  frameCount: number
}

/** Stable per-cell pseudo-random value, 0..1 -- same (x, y) always hashes to
 *  the same number, so effects can vary per-glyph without storing state. */
function hash2(x: number, y: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/** Perturbs `tone` in place for the current loop phase and, for "decode",
 *  returns a per-cell glyph-index override (-1 = no override). Runs between
 *  tone mapping and dithering so the motion is baked into the same glyphs a
 *  still render would pick, rather than layered on top of them. */
export function applyAnim(tone: Float32Array, cols: number, rows: number, anim: AnimSettings, levels: number): Int16Array | null {
  const { mode, amount: amt, phase: p } = anim
  const TAU = Math.PI * 2

  if (mode === "shimmer") {
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        tone[i] = clamp(tone[i] + amt * 0.5 * Math.sin(TAU * (p + hash2(x, y))), 0, 1)
      }
    return null
  }

  if (mode === "wave") {
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const u = (x / cols) * 0.75 + (y / rows) * 0.25
        tone[i] = clamp(tone[i] + amt * 0.55 * Math.cos(TAU * (u - p)), 0, 1)
      }
    return null
  }

  if (mode === "rain") {
    const trail = Math.max(4, rows * 0.4)
    for (let x = 0; x < cols; x++) {
      const cycles = 1 + Math.floor(hash2(x, 13) * 2) // integer cycles keep it seamless
      const head = ((p * cycles + hash2(x, 7)) % 1) * (rows + trail) - trail * 0.5
      for (let y = 0; y < rows; y++) {
        const d = head - y
        if (d < 0 || d > trail) continue
        const f = d < 1 ? 1 : 1 - d / trail
        const i = y * cols + x
        tone[i] = clamp(tone[i] + amt * f, 0, 1)
      }
    }
    return null
  }

  if (mode === "decode") {
    const n = cols * rows
    const override = new Int16Array(n).fill(-1)
    const step = Math.floor(p * Math.max(2, anim.frameCount)) // glyphs re-scramble per frame
    const q = p < 0.62 ? p / 0.62 : p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15 // resolve, hold, dissolve
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        if (tone[i] < 0.04) continue // keep the silhouette clean
        const thr = hash2(x, y) * 0.75 + (y / rows) * 0.25
        if (q < thr) override[i] = 1 + Math.floor(hash2(x * 31 + step, y * 17 + step * 7) * (levels - 1))
      }
    return override
  }

  return null
}

/** 256-entry tone -> css colour lookup, blended toward paper by ink strength */
export function buildLUT(paper: string, stops: string[], strength: number): string[] {
  const paperRGB = hex2rgb(paper)
  const lut = new Array(256)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let c = stopsAt(stops, t)
    if (strength < 1) {
      const k = strength
      c = [
        paperRGB[0] + (c[0] - paperRGB[0]) * k,
        paperRGB[1] + (c[1] - paperRGB[1]) * k,
        paperRGB[2] + (c[2] - paperRGB[2]) * k,
      ]
    }
    lut[i] = rgb2hex(c[0], c[1], c[2])
  }
  return lut
}

/** Build the glyph + colour grid from a sampled RGBA buffer. `anim` is only
 *  passed while a motion effect is playing -- omit it (or pass mode "none")
 *  for a still render. */
export function buildGrid(rgba: Uint8ClampedArray, cols: number, rows: number, s: ToneSettings, anim?: AnimSettings | null): Grid {
  const n = cols * rows
  const chars = s.ramp === "custom" ? s.customRamp || " .:-=+*#%@" : RAMPS[s.ramp]
  const set = Array.from(chars)
  const levels = set.length

  const inkL = lumOf(stopsAt(s.stops, 1) as [number, number, number])
  const paperL = lumOf(hex2rgb(s.paper))
  const lighterInk = inkL >= paperL

  const tone = new Float32Array(n)
  const alpha = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const o = i * 4
    const a = rgba[o + 3] / 255
    alpha[i] = a
    let l = (0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]) / 255
    if (!s.alphaKeep) l = l * a + paperL * (1 - a)
    l = (l - 0.5) * s.contrast + 0.5 + s.brightness
    l = Math.pow(clamp(l, 0, 1), s.gamma)
    let t = lighterInk ? l : 1 - l
    if (s.invert) t = 1 - t
    tone[i] = clamp(t, 0, 1)
  }

  // Motion modulates tone before quantisation, so the glyphs themselves
  // change rather than a filter running on top of a fixed image.
  let override: Int16Array | null = null
  if (anim && anim.mode !== "none") override = applyAnim(tone, cols, rows, anim, levels)

  const q = new Float32Array(tone)
  if (s.dither === "ordered") {
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        q[i] = clamp(tone[i] + (BAYER[y & 3][x & 3] / 16 - 0.46875) / (levels - 1), 0, 1)
      }
  } else if (s.dither === "diffuse") {
    const step = 1 / (levels - 1)
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const old = q[i]
        const nv = clamp(Math.round(old / step) * step, 0, 1)
        q[i] = nv
        const err = old - nv
        if (x + 1 < cols) q[i + 1] += (err * 7) / 16
        if (y + 1 < rows) {
          if (x > 0) q[i + cols - 1] += (err * 3) / 16
          q[i + cols] += (err * 5) / 16
          if (x + 1 < cols) q[i + cols + 1] += (err * 1) / 16
        }
      }
  }

  let mag: Float32Array | null = null
  let ang: Float32Array | null = null
  if (s.edges) {
    mag = new Float32Array(n)
    ang = new Float32Array(n)
    const at = (x: number, y: number) => tone[clamp(y, 0, rows - 1) * cols + clamp(x, 0, cols - 1)]
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
        const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
        const i = y * cols + x
        mag[i] = Math.hypot(gx, gy) / 4
        ang[i] = Math.atan2(gy, gx)
      }
  }
  const EDGE_CH = ["-", "\\", "|", "/"]
  const thr = s.edges ? 1.02 - s.edgeSensitivity : 2

  const ch: string[] = new Array(n)
  const col: (string | null)[] = new Array(n)
  const lut = buildLUT(s.paper, s.stops, s.inkStrength)
  const mixP = s.srcColor ? s.mix : 1

  for (let i = 0; i < n; i++) {
    if (s.alphaKeep && alpha[i] < 0.35) {
      ch[i] = " "
      col[i] = null
      continue
    }
    let t = clamp(q[i], 0, 1)
    let gi = Math.min(levels - 1, Math.round(t * (levels - 1)))
    if (override && override[i] >= 0) {
      gi = Math.min(levels - 1, override[i])
      t = Math.max(t, 0.4)
    }
    let glyph = set[gi]

    if (s.edges && mag && ang && mag[i] > thr) {
      const dir = ang[i] + Math.PI / 2
      const b = ((Math.round(dir / (Math.PI / 4)) % 4) + 4) % 4
      glyph = EDGE_CH[b]
      t = Math.max(t, clamp(mag[i], 0, 1))
    }
    if (glyph === " ") {
      ch[i] = " "
      col[i] = null
      continue
    }

    ch[i] = glyph
    let c = lut[Math.round(t * 255)]
    if (s.srcColor) {
      const o = i * 4
      const sc: [number, number, number] = [rgba[o], rgba[o + 1], rgba[o + 2]]
      if (mixP > 0) {
        const p = hex2rgb(c)
        c = rgb2hex(sc[0] + (p[0] - sc[0]) * mixP, sc[1] + (p[1] - sc[1]) * mixP, sc[2] + (p[2] - sc[2]) * mixP)
      } else {
        c = rgb2hex(sc[0], sc[1], sc[2])
      }
    }
    col[i] = c
  }
  return { cols, rows, ch, col, set }
}

/** advance-width / line-height ratio for a monospace font at any size */
export function cellAspect(ctx: CanvasRenderingContext2D, fontFamily: string, lineHeight: number): number {
  ctx.font = `500 100px ${fontFamily}`
  const w = ctx.measureText("M").width || 60
  return w / (100 * lineHeight)
}

export function gridSize(
  cols: number,
  imgW: number,
  imgH: number,
  cellAr: number,
  canvasCustom: boolean,
  canvasW: number,
  canvasH: number
) {
  const ar = canvasCustom ? canvasH / canvasW : imgH / imgW
  const rows = Math.max(1, Math.round(cols * ar * cellAr))
  return { cols, rows }
}

export function fontString(px: number, fontFamily: string) {
  return `500 ${px}px ${fontFamily}`
}

/** Paint a grid onto a canvas at a given font-size scale. */
export function paint(
  canvas: HTMLCanvasElement,
  g: Grid,
  fontPx: number,
  lineHeight: number,
  fontFamily: string,
  paper: string,
  transparentBg: boolean,
  forceOpaque: boolean
) {
  const ctx = canvas.getContext("2d")!
  ctx.font = fontString(fontPx, fontFamily)
  const cw = ctx.measureText("M").width
  const chh = fontPx * lineHeight
  canvas.width = Math.max(1, Math.round(cw * g.cols))
  canvas.height = Math.max(1, Math.round(chh * g.rows))

  ctx.font = fontString(fontPx, fontFamily)
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"

  if (!transparentBg || forceOpaque) {
    ctx.fillStyle = paper
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  for (let y = 0; y < g.rows; y++) {
    const base = y * g.cols
    const cy = y * chh + chh / 2
    let run = ""
    let runCol: string | null = null
    let runX = 0
    for (let x = 0; x < g.cols; x++) {
      const i = base + x
      const c = g.col[i]
      const chr = g.ch[i]
      if (c === null || chr === " ") {
        if (run) {
          ctx.fillStyle = runCol!
          ctx.fillText(run, runX, cy)
          run = ""
          runCol = null
        }
        continue
      }
      if (c !== runCol) {
        if (run) {
          ctx.fillStyle = runCol!
          ctx.fillText(run, runX, cy)
        }
        run = chr
        runCol = c
        runX = x * cw
      } else {
        run += chr
      }
    }
    if (run) {
      ctx.fillStyle = runCol!
      ctx.fillText(run, runX, cy)
    }
  }
  return { cw, chh }
}

export function gridToText(g: Grid): string {
  const lines: string[] = []
  for (let y = 0; y < g.rows; y++) {
    lines.push(
      g.ch
        .slice(y * g.cols, (y + 1) * g.cols)
        .join("")
        .replace(/\s+$/, "")
    )
  }
  return lines.join("\n")
}

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function gridToSVG(
  g: Grid,
  fontPx: number,
  lineHeight: number,
  fontFamily: string,
  paper: string,
  transparentBg: boolean,
  cw: number,
  outW?: number,
  outH?: number
): string {
  const chh = fontPx * lineHeight
  const W = outW ?? Math.round(cw * g.cols)
  const H = outH ?? Math.round(chh * g.rows)
  const rootAttrs = `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}>`,
    transparentBg ? "" : `<rect width="${W}" height="${H}" fill="${paper}"/>`,
    `<g font-family="${fontFamily}" font-size="${fontPx}" font-weight="500" text-anchor="start">`,
  ]
  for (let y = 0; y < g.rows; y++) {
    const base = y * g.cols
    const cy = (y * chh + chh / 2).toFixed(2)
    let run = ""
    let runCol: string | null = null
    let runX = 0
    const flush = () => {
      if (!run) return
      out.push(
        `<text x="${runX.toFixed(2)}" y="${cy}" dominant-baseline="central" fill="${runCol}" textLength="${(run.length * cw).toFixed(2)}" lengthAdjust="spacing" xml:space="preserve">${escXml(run)}</text>`
      )
      run = ""
      runCol = null
    }
    for (let x = 0; x < g.cols; x++) {
      const i = base + x
      const c = g.col[i]
      const chr = g.ch[i]
      if (c === null || chr === " ") {
        flush()
        continue
      }
      if (c !== runCol) {
        flush()
        run = chr
        runCol = c
        runX = x * cw
      } else run += chr
    }
    flush()
  }
  out.push("</g></svg>")
  return out.join("\n")
}
