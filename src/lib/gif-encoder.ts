// Self-contained GIF89a encoder -- ported from the standalone Glyphworks
// prototype. No dependencies: median-cut palette, LZW, and delta frames that
// redraw only the pixels that actually changed between frames.

import { clamp, hex2rgb } from "@/lib/ascii-engine"

type RGB = [number, number, number]

/** Growable byte buffer. */
class ByteWriter {
  private buf = new Uint8Array(1 << 18)
  private len = 0

  private need(n: number) {
    if (this.len + n <= this.buf.length) return
    let cap = this.buf.length
    while (cap < this.len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  u8(v: number) {
    this.need(1)
    this.buf[this.len++] = v & 255
  }
  u16(v: number) {
    this.need(2)
    this.buf[this.len++] = v & 255
    this.buf[this.len++] = (v >> 8) & 255
  }
  bytes(a: Uint8Array) {
    this.need(a.length)
    this.buf.set(a, this.len)
    this.len += a.length
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i))
  }
  done() {
    return this.buf.subarray(0, this.len)
  }
}

function lzwEncode(px: Uint8Array, minCode: number, out: ByteWriter) {
  const clear = 1 << minCode
  const eoi = clear + 1
  let codeSize = minCode + 1
  let next = eoi + 1
  let dict = new Map<number, number>()
  let cur = 0
  let curBits = 0
  const block = new Uint8Array(255)
  let bn = 0

  const flushBlock = () => {
    if (bn) {
      out.u8(bn)
      out.bytes(block.subarray(0, bn))
      bn = 0
    }
  }
  const emit = (code: number) => {
    cur |= code << curBits
    curBits += codeSize
    while (curBits >= 8) {
      block[bn++] = cur & 255
      cur >>>= 8
      curBits -= 8
      if (bn === 255) flushBlock()
    }
  }

  emit(clear)
  let prefix = px[0]
  for (let i = 1; i < px.length; i++) {
    const k = px[i]
    const key = (prefix << 8) | k
    const v = dict.get(key)
    if (v !== undefined) {
      prefix = v
      continue
    }
    emit(prefix)
    if (next >= 4096) {
      // table full -- restart it
      emit(clear)
      dict = new Map()
      next = eoi + 1
      codeSize = minCode + 1
    } else {
      // Grow before assigning the code that would overflow: this is the timing
      // the decoder expects, and growing one step late desyncs it.
      if (next >= 1 << codeSize && codeSize < 12) codeSize++
      dict.set(key, next++)
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (curBits > 0) {
    block[bn++] = cur & 255
    if (bn === 255) flushBlock()
  }
  flushBlock()
}

/** `bits` is the colour-table depth (2-8); smaller tables mean smaller codes. */
function gifStart(w: number, h: number, pal: RGB[], bits: number) {
  const out = new ByteWriter()
  out.str("GIF89a")
  out.u16(w)
  out.u16(h)
  out.u8(0x80 | ((bits - 1) << 4) | (bits - 1))
  out.u8(0)
  out.u8(0)
  const entries = 1 << bits
  for (let i = 0; i < entries; i++) {
    const c = pal[i] || [0, 0, 0]
    out.u8(c[0])
    out.u8(c[1])
    out.u8(c[2])
  }
  out.u8(0x21)
  out.u8(0xff)
  out.u8(11)
  out.str("NETSCAPE2.0")
  out.u8(3)
  out.u8(1)
  out.u16(0)
  out.u8(0) // loop forever
  return out
}

/** One frame, optionally cropped, with `trans` marking "unchanged -- let the
 *  previous frame show through" (disposal method 1). */
function gifFrame(
  out: ByteWriter,
  idx: Uint8Array,
  x: number,
  y: number,
  w: number,
  h: number,
  delayCs: number,
  trans: number | null,
  minCode: number
) {
  const hasTrans = trans !== null
  out.u8(0x21)
  out.u8(0xf9)
  out.u8(4)
  out.u8(0x04 | (hasTrans ? 1 : 0))
  out.u16(delayCs)
  out.u8(hasTrans ? trans : 0)
  out.u8(0)
  out.u8(0x2c)
  out.u16(x)
  out.u16(y)
  out.u16(w)
  out.u16(h)
  out.u8(0)
  out.u8(minCode)
  lzwEncode(idx, minCode, out)
  out.u8(0)
}

/** Median-cut quantisation down to `maxColors`, with the paper colour pinned
 *  to slot 0 so flat background never shifts. */
function buildPalette(samples: Uint8ClampedArray[], maxColors: number, paper: string): RGB[] {
  const cap = clamp(maxColors || 256, 4, 256)
  const hist = new Map<number, number>()
  for (const d of samples) {
    const stride = d.length > 1_600_000 ? 8 : 4
    for (let i = 0; i < d.length; i += stride) {
      const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)
      hist.set(k, (hist.get(k) || 0) + 1)
    }
  }

  type Pt = { r: number; g: number; b: number; c: number }
  let boxes: Pt[][] = [[...hist.entries()].map(([k, c]) => ({ r: (k >> 10) & 31, g: (k >> 5) & 31, b: k & 31, c }))]

  const spread = (box: Pt[], ch: "r" | "g" | "b") => {
    let lo = 99
    let hi = -1
    for (const p of box) {
      if (p[ch] < lo) lo = p[ch]
      if (p[ch] > hi) hi = p[ch]
    }
    return hi - lo
  }

  while (boxes.length < cap - 1) {
    let bi = -1
    let best = 0
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      if (b.length < 2) continue
      const s = Math.max(spread(b, "r"), spread(b, "g"), spread(b, "b")) * b.length
      if (s > best) {
        best = s
        bi = i
      }
    }
    if (bi < 0) break
    const b = boxes[bi]
    const ch: "r" | "g" | "b" =
      spread(b, "g") >= spread(b, "r") && spread(b, "g") >= spread(b, "b") ? "g" : spread(b, "r") >= spread(b, "b") ? "r" : "b"
    b.sort((p, q) => p[ch] - q[ch])
    let total = 0
    for (const p of b) total += p.c
    let acc = 0
    let cut = 1
    for (let i = 0; i < b.length; i++) {
      acc += b[i].c
      if (acc >= total / 2) {
        cut = clamp(i, 1, b.length - 1)
        break
      }
    }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut))
  }

  const pal = boxes.map((b) => {
    let r = 0
    let g = 0
    let bl = 0
    let n = 0
    for (const p of b) {
      r += p.r * p.c
      g += p.g * p.c
      bl += p.b * p.c
      n += p.c
    }
    return [Math.round((r / n) * 8.226), Math.round((g / n) * 8.226), Math.round((bl / n) * 8.226)] as RGB
  })

  return [hex2rgb(paper).map(Math.round) as RGB, ...pal].slice(0, cap)
}

/** Nearest palette entry for every 15-bit colour, weighted by luminance. */
function paletteLUT(pal: RGB[]) {
  const lut = new Uint8Array(32768)
  for (let k = 0; k < 32768; k++) {
    const r = ((k >> 10) & 31) * 8.226
    const g = ((k >> 5) & 31) * 8.226
    const b = (k & 31) * 8.226
    let best = 0
    let bd = Infinity
    for (let i = 0; i < pal.length; i++) {
      const c = pal[i]
      const dr = c[0] - r
      const dg = c[1] - g
      const db = c[2] - b
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
      if (d < bd) {
        bd = d
        best = i
      }
    }
    lut[k] = best
  }
  return lut
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0))

export interface GifOptions {
  width: number
  height: number
  frames: number
  /** Frame delay in hundredths of a second -- GIF's own unit. */
  delayCs: number
  maxColors: number
  paper: string
  /** Renders frame `i` and returns its RGBA pixels, opaque. */
  renderFrame: (index: number) => Uint8ClampedArray
  onProgress?: (done: number, total: number) => void
}

export interface GifResult {
  blob: Blob
  colors: number
}

export async function encodeGif(opts: GifOptions): Promise<GifResult> {
  const { width: W, height: H, frames, delayCs, renderFrame, onProgress } = opts
  if (W * H * frames > 900e6) throw new Error("that many pixels won't fit in memory -- try a smaller width or a shorter loop")

  // Sample a few frames spread across the loop so the palette covers the whole
  // animation, not just its first frame.
  const samples: Uint8ClampedArray[] = []
  for (const f of [0, Math.floor(frames / 3), Math.floor((2 * frames) / 3)]) {
    samples.push(renderFrame(f))
    await yieldUI()
  }
  const pal = buildPalette(samples, opts.maxColors, opts.paper)
  await yieldUI()
  const map = paletteLUT(pal)
  samples.length = 0
  await yieldUI()

  // One slot past the palette carries "unchanged" pixels.
  const trans = pal.length
  const bits = clamp(Math.ceil(Math.log2(trans + 1)), 2, 8)
  const minCode = bits

  const out = gifStart(W, H, pal, bits)
  const idx = new Uint8Array(W * H)
  const prev = new Uint8Array(W * H)

  for (let f = 0; f < frames; f++) {
    const d = renderFrame(f)
    for (let i = 0, p = 0; i < idx.length; i++, p += 4) {
      idx[i] = map[((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3)]
    }

    if (f === 0) {
      gifFrame(out, idx, 0, 0, W, H, delayCs, null, minCode) // first frame paints everything
    } else {
      // Crop to what changed, and mark the rest transparent so the previous
      // frame shows through.
      let x0 = W
      let y0 = H
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < H; y++) {
        const row = y * W
        for (let x = 0; x < W; x++) {
          if (idx[row + x] !== prev[row + x]) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
        }
      }
      if (x1 < 0) {
        const dot = new Uint8Array(1)
        dot[0] = trans
        gifFrame(out, dot, 0, 0, 1, 1, delayCs, trans, minCode) // nothing changed -- hold
      } else {
        const bw = x1 - x0 + 1
        const bh = y1 - y0 + 1
        const sub = new Uint8Array(bw * bh)
        for (let y = 0; y < bh; y++) {
          const s = (y0 + y) * W + x0
          const dst = y * bw
          for (let x = 0; x < bw; x++) {
            const v = idx[s + x]
            sub[dst + x] = v === prev[s + x] ? trans : v
          }
        }
        gifFrame(out, sub, x0, y0, bw, bh, delayCs, trans, minCode)
      }
    }
    prev.set(idx)
    onProgress?.(f + 1, frames)
    await yieldUI()
  }
  out.u8(0x3b)

  return { blob: new Blob([out.done()], { type: "image/gif" }), colors: pal.length }
}
