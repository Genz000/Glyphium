# Glyphium

**[Open the app →](https://genz000.github.io/Glyphium/)**

ASCII-art conversion for images and SVG, live in the browser — no server, no
upload, no account. Drop in a photo or an SVG and it's rendered as monospace
glyphs, colour-mapped through one of ten locked "vibe" palettes (or your own
paper/ink colours), with control over grid resolution, tone curve,
dithering, and edge-aware glyph selection for line art. Export as PNG at up
to 4×, or as a real, editable SVG.

## Stack

- [Vite](https://vite.dev) + React 19 + TypeScript
- Tailwind CSS v4 (CSS-first `@theme` tokens, no config file)
- Hand-rolled [shadcn](https://ui.shadcn.com)-style components on
  [Radix UI](https://www.radix-ui.com) primitives
- Self-hosted [Bricolage Grotesque](https://github.com/fonttools/fonts) +
  [JetBrains Mono](https://www.jetbrains.com/lp/mono/) via `@fontsource`

No external font or asset CDN is used — everything ships in the bundle.

## Design system

The palette is locked, not eyeballed: a graphite ground with a periwinkle
accent, checked against WCAG contrast before anything was built on top of it.

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
  components/ui/          shadcn-style primitives (Button, Slider, Select, …)
  components/             FileDrop, VibePicker, ToneLadder
  App.tsx                 control rail + preview stage
```

## Roadmap

This is a from-scratch React port of a working single-file prototype. Ported
so far: file loading (image + SVG), grid resolution, character ramps
(including custom), tone mapping (brightness/contrast/gamma), ordered and
diffusion dithering, edge-aware glyphs, ten colour vibes with custom
paper/ink, source-colour tinting, transparency, and PNG/SVG export.

Not yet ported from the prototype: pan/zoom stage controls, the motion
system (Shimmer/Wave/Rain/Decode animation), and GIF/WebM/animated-SVG
export. Straightforward to add on top of the same engine — the pixel
sampling and grid-building functions are already frame-agnostic.

## License

MIT
