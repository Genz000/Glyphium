// Timeline maths. A project is a list of clips; each clip holds on screen for
// `hold` seconds -- animating the whole time -- then hands over to the next one
// across `transition` seconds. The last clip hands back to the first, so the
// loop is seamless. One clip on its own just holds, with nothing to hand to.

export interface ClipTiming {
  /** Seconds this image stays on screen, animating. */
  hold: number
  /** Seconds spent handing over to the next clip. */
  transition: number
}

export interface Segment {
  kind: "hold" | "transition"
  /** Clip this segment belongs to; a transition runs from `index` to `next`. */
  index: number
  next: number
  start: number
  duration: number
}

export const MIN_HOLD = 0.3
export const MIN_TRANSITION = 0.1

/** Transitions only exist once there's somewhere to go. */
export const hasTransitions = (count: number) => count > 1

export function segmentsOf(clips: ClipTiming[]): Segment[] {
  const out: Segment[] = []
  let t = 0
  clips.forEach((c, i) => {
    out.push({ kind: "hold", index: i, next: i, start: t, duration: c.hold })
    t += c.hold
    if (hasTransitions(clips.length)) {
      out.push({ kind: "transition", index: i, next: (i + 1) % clips.length, start: t, duration: c.transition })
      t += c.transition
    }
  })
  return out
}

export function totalDuration(clips: ClipTiming[]): number {
  return clips.reduce((t, c) => t + c.hold + (hasTransitions(clips.length) ? c.transition : 0), 0)
}

export interface Position {
  /** Clip on screen, or the one being handed away from. */
  index: number
  /** Clip being handed to; equal to `index` while holding. */
  next: number
  /** 0..1 through the handover, or null while holding. */
  progress: number | null
  /** 0..1 through the current hold; 1 during a handover. */
  holdProgress: number
}

/** Where a loop phase (0..1) lands on the timeline. */
export function positionAt(clips: ClipTiming[], phase: number): Position {
  const last = Math.max(0, clips.length - 1)
  if (clips.length === 0) return { index: 0, next: 0, progress: null, holdProgress: 0 }
  const total = totalDuration(clips)
  if (total <= 0) return { index: 0, next: 0, progress: null, holdProgress: 0 }

  let t = (((phase % 1) + 1) % 1) * total
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]
    if (t < c.hold) {
      return { index: i, next: i, progress: null, holdProgress: c.hold > 0 ? t / c.hold : 0 }
    }
    t -= c.hold
    if (hasTransitions(clips.length)) {
      if (t < c.transition) {
        return {
          index: i,
          next: (i + 1) % clips.length,
          progress: c.transition > 0 ? t / c.transition : 1,
          holdProgress: 1,
        }
      }
      t -= c.transition
    }
  }
  // Floating-point slop at the very end of the loop.
  return { index: last, next: last, progress: null, holdProgress: 1 }
}

/** Phase (0..1) at which a clip's hold begins -- what the playhead jumps to
 *  when you select that clip. */
export function phaseOfClipStart(clips: ClipTiming[], index: number): number {
  const total = totalDuration(clips)
  if (total <= 0) return 0
  const seg = segmentsOf(clips).find((s) => s.kind === "hold" && s.index === index)
  return seg ? seg.start / total : 0
}
