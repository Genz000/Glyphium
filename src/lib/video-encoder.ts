// MP4 (H.264) export. Frames are encoded one at a time through WebCodecs, so
// timing is exact and encoding runs as fast as the machine allows -- unlike
// MediaRecorder, which can only capture in real time and drops frames under
// load. MediaRecorder is kept as a fallback for browsers without WebCodecs.

import { ArrayBufferTarget, Muxer } from "mp4-muxer"

export interface VideoOptions {
  width: number
  height: number
  frames: number
  fps: number
  /** Draws frame `i` onto the canvas that is handed back for encoding. */
  renderFrame: (index: number) => HTMLCanvasElement
  onProgress?: (done: number, total: number) => void
}

export interface VideoResult {
  blob: Blob
  /** File extension matching the container that was actually produced. */
  ext: "mp4" | "webm"
}

/** ASCII art is all hard edges, so it needs a fatter bitrate than photography
 *  at the same size before the glyph edges start to mush. */
const bitrateFor = (w: number, h: number, fps: number) => Math.round(Math.min(Math.max(w * h * fps * 0.2, 2_000_000), 24_000_000))

const H264_CODECS = ["avc1.640034", "avc1.640028", "avc1.4d0028", "avc1.42001f"]

async function pickH264Codec(width: number, height: number, fps: number) {
  if (typeof VideoEncoder === "undefined" || !VideoEncoder.isConfigSupported) return null
  for (const codec of H264_CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: bitrateFor(width, height, fps),
        framerate: fps,
      })
      if (support.supported) return codec
    } catch {
      // try the next one
    }
  }
  return null
}

async function encodeWithWebCodecs(opts: VideoOptions, codec: string): Promise<VideoResult> {
  const { width, height, frames, fps, renderFrame, onProgress } = opts
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    fastStart: "in-memory", // the moov atom goes first, so it streams and previews anywhere
  })

  let failure: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e))
    },
  })
  encoder.configure({ codec, width, height, bitrate: bitrateFor(width, height, fps), framerate: fps })

  const frameDuration = 1_000_000 / fps // microseconds
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure
    const canvas = renderFrame(i)
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDuration), duration: Math.round(frameDuration) })
    // A keyframe every couple of seconds keeps seeking and looping responsive.
    encoder.encode(frame, { keyFrame: i === 0 || i % (fps * 2) === 0 })
    frame.close()
    onProgress?.(i + 1, frames)
    // Let the encoder drain so its queue can't outrun memory on long loops.
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0))
  }

  await encoder.flush()
  encoder.close()
  if (failure) throw failure
  muxer.finalize()
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4" }
}

function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return null
  const want = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
  return want.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

/** Real-time capture, used only where WebCodecs is missing. The canvas is
 *  driven frame by frame with requestFrame so nothing is dropped, but the run
 *  still takes as long as the animation itself. */
async function encodeWithRecorder(opts: VideoOptions): Promise<VideoResult> {
  const { width, height, frames, fps, renderFrame, onProgress } = opts
  const mime = pickRecorderMime()
  if (!mime) throw new Error("this browser can't record video -- save a GIF instead")

  const first = renderFrame(0)
  const stream = first.captureStream(0) as MediaStream & { getVideoTracks(): MediaStreamTrack[] }
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  const chunks: Blob[] = []
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(width, height, fps) })
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()))
  rec.start()

  for (let i = 0; i < frames; i++) {
    renderFrame(i)
    track.requestFrame?.()
    onProgress?.(i + 1, frames)
    await new Promise((r) => setTimeout(r, 1000 / fps))
  }

  rec.stop()
  await stopped
  track.stop()
  const blob = new Blob(chunks, { type: mime })
  return { blob, ext: mime.startsWith("video/mp4") ? "mp4" : "webm" }
}

export async function encodeVideo(opts: VideoOptions): Promise<VideoResult> {
  const codec = await pickH264Codec(opts.width, opts.height, opts.fps)
  if (codec) return encodeWithWebCodecs(opts, codec)
  return encodeWithRecorder(opts)
}
