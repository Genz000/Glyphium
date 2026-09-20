# Glyphium

**[Open the app →](https://genz000.github.io/Glyphium/)**

ASCII-art conversion for images and SVG, live in the browser — no server, no
upload, no account. Drop in a photo or an SVG and it's rendered as monospace
glyphs, colour-mapped through one of ten locked "vibe" palettes (or your own
paper/ink colours), with control over grid resolution, tone curve,
dithering, and edge-aware glyph selection for line art. Four motion effects
(Shimmer, Decode, Wave, Rain) animate the glyphs themselves, looping
seamlessly, and save as an animated GIF or an MP4 for social media. Load a
second image and the loop runs A → B → back, with the handover drawn in the
effect's own pattern. Reframe any image to 1:1, 4:5, 3:2, 16:9 or 9:16 — it's
cropped to fill the new frame edge to edge, never letterboxed — and scale it
within that frame. Export a still as PNG at up to 4×, or as a real, editable
SVG.

## Stack

- [Vite](https://vite.dev) + React 19 + TypeScript
- Tailwind CSS v4 (CSS-first `@theme` tokens, no config file)
- [shadcn/ui](https://ui.shadcn.com) (new-york style) on
  [Radix UI](https://www.radix-ui.com) primitives — installed through the
  shadcn CLI and configured in `components.json`, so `npx shadcn@latest add …`
  drops new components straight in
- Self-hosted [Bricolage Grotesque](https://github.com/fonttools/fonts) +
  [JetBrains Mono](https://www.jetbrains.com/lp/mono/) via `@fontsource`

No external font or asset CDN is used — everything ships in the bundle.

## Design system

The theme is written against shadcn's own token contract — `--background`,
`--foreground`, `--card`, `--primary`, `--muted-foreground`, `--border`,
`--input`, `--ring`, `--radius` — themed as **Darkroom**: a graphite ground
with a periwinkle primary. Any shadcn component added later inherits the theme
with no restyling.

Glyphium is dark-only by intent, so the Darkroom values sit on `:root` and
`<html>` carries `class="dark"` so shadcn's `dark:` variants resolve against
the same palette. Adding a light theme means writing light values on `:root`
and moving these into `.dark` — no component changes.

Colours are hex rather than oklch on purpose: every pairing below was
contrast-checked at these exact values, and converting colour space would move
the ratios.

| Pairing | Ratio | Grade |
|---|---|---|
| ink on background | 15.31:1 | AAA |
| dim label on background | 5.51:1 | AA |
| accent on background | 7.90:1 | AAA |
| background on accent (button labels) | 7.90:1 | AAA |
| dimmer meta text on background | 3.87:1 | AA (large text) |

Type pairing: **Bricolage Grotesque** for display, **JetBrains Mono**
throughout the UI and as the rendering font for the artwork itself — the tool
and the output share one voice.

The stage borrows from proof printing: the render is mounted as a plate on a
darker mat, squared by hairline registration marks, and annotated in the margin
with file, source size, grid, glyph count, and render time. The preview is
repainted at whatever scale it is actually displayed at — including device
pixel ratio — so glyphs stay crisp instead of being stretched by the browser.

The tone ramp printed under the stage doubles as an editor: click any glyph to
retype just that tone level — type a replacement or pick one from a small
block of common glyphs — without hand-editing the whole ramp string. The first
edit forks the active preset into a custom ramp; the rest of it is untouched.

With a second image loaded, the loop is hold A, hand over, hold B, hand back.
Cells don't cross-fade: each one flips at its own threshold, ordered by the
effect driving it -- a wave wipes across, rain falls down its columns,
decode and shimmer dissolve cell by cell -- and cells caught mid-flight
scramble, which is what makes a decode handover read as decode. The grid is
sized from the first image, so the second is placed into the same frame.

Motion is baked into the same tone-mapping step as everything else, not
layered on top as a filter: each effect perturbs the tone field by loop
phase before quantisation, so the animation is made of the same glyph
selection a still render would use. Every effect is periodic in phase, so a
full loop tiles back to its start with no seam. Pausing (or picking a
different effect while paused) always lands back on the plain image rather
than freezing mid-motion — space bar toggles play/pause from anywhere that
isn't a text field.

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check and produce a production build in dist/
npm run preview   # serve the production build locally
```

## Project layout

```
src/
  lib/ascii-engine.ts     pure conversion engine (sampling, tone mapping,
                           dithering, edge detection, PNG/SVG rendering)
  hooks/use-ascii-art.ts  React state <-> engine glue
  components/ui/          shadcn/ui primitives (Button, Slider, Select, …)
  components/             FileDrop, VibePicker, ToneLadder
  App.tsx                 control rail + preview stage
```

## Roadmap

This is a from-scratch React port of a working single-file prototype. Ported
so far: file loading (image + SVG), grid resolution, character ramps
(including custom, editable per-glyph), tone mapping (brightness/contrast/
gamma), ordered and diffusion dithering, edge-aware glyphs, ten colour vibes
with custom paper/ink, source-colour tinting, transparency, the live motion
system (Shimmer, Decode, Wave, Rain), and PNG/SVG export.

Motion saves to GIF (a self-contained GIF89a encoder: median-cut palette,
LZW, delta frames) and to MP4/H.264, encoded frame by frame through
WebCodecs so timing is exact rather than captured in real time. Browsers
without WebCodecs fall back to MediaRecorder.

Not yet ported from the prototype: pan/zoom stage controls and animated-SVG
export. Both are straightforward to add on top of the same engine -- the
pixel sampling and grid-building functions are already frame-agnostic.

## License

MIT
