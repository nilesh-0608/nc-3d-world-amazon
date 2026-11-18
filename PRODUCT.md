# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who open a link out of curiosity and want to be somewhere for a few minutes. They arrive
cold, with no instructions and no investment, on whatever device they happen to be holding —
phones and integrated graphics included, not only desktops with discrete GPUs. Their job is not a
task; it is to look around. Success is that they stay, move the camera, and find something they
did not expect.

A second, smaller audience reads the source: people who want to know how a scene like this is
built, or who want to replicate the process. `prompt.md` exists for them.

## Product Purpose

A procedural Amazon rainforest that runs in a browser, in a single HTML file, with nothing to
install and nothing to download. The whole world — terrain, trees, foliage, creatures, light and
sound — is generated from mathematics when the page opens.

Success is that it is worth sending to someone.

## Positioning

Three things hold together that usually do not:

- **It is one file.** Not a build artifact plus assets — a single self-contained `index.html`
  that works offline and can be emailed.
- **Nothing is authored but code.** No textures, no models, no audio files. A forest of roughly
  two million leaves is a few hundred lines of maths.
- **It runs everywhere it can.** Adaptive resolution and three detail levels mean the same world
  on a phone as on a workstation, with less in it.

It is also an honest record of how it was made: an AI agent built it from a written brief, and
that brief ships with it.

## Operating Context

Opened from a link, in a browser tab, usually once. There is no account, no state, no network
traffic after load. A visitor's entire relationship with it happens in the first minute: a start
screen, a few seconds of world generation, and then free flight.

It requires WebGPU. Browsers without it, or with hardware acceleration disabled, get a plain
message rather than a broken scene.

## Capabilities and Constraints

**Confirmed capabilities**

- Free six-degree camera flight through three vertical layers: forest floor, mid-storey, canopy
  and open sky above it.
- Six fixed viewpoints, a day/night toggle, three detail levels, and a performance overlay.
- Collision against terrain so the visitor slides along rock rather than passing through it.
- A synthesized soundscape.

**Binding constraints — all four confirmed by the user, and future work must preserve them**

1. **Single self-contained file.** One `index.html`, no asset files, no runtime dependencies,
   works offline. The architecture rests on this.
2. **Everything procedural.** No textures, no models, no audio files. Generated from maths at
   load. This rules out many otherwise easy visual wins.
3. **Performance budget.** GPU frame time under roughly 11 ms at 1440p, adaptive resolution
   holding 60 fps, degrading gracefully on weak hardware.
4. **Abyssal Garden attribution.** Credit stays visible and the MIT lineage stays honest, even as
   the code diverges from its parent.

**Technical constraints**

- WebGPU only; no WebGL fallback exists.
- Zero per-frame JavaScript allocation — the renderer preallocates everything.
- Node 18+ is needed only to build; the output needs nothing.

**Explicitly undecided**

- Whether the audio is replaced or removed. It is currently inherited underwater ambience and is
  wrong for the setting.
- Whether trunk collision is added. The camera currently passes through trees.

## Brand Commitments

Named **nc-3d-world-amazon**, by nilesh-0608. The start screen is a naturalist's field record — serif type on aged paper,
ruled lines, specimen labelling — deliberately chosen to be unlike its parent project's centred
wordmark over a blurred scene.

Attribution to [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian Dendura
is a binding commitment, not a courtesy. The renderer, adaptive-resolution controller,
surface-nets terrain, brick-sparse SDF collision and single-file build originate there, MIT
licensed.

## Evidence on Hand

- The working scene: `index.html`, built from `source/`.
- Published at <https://github.com/nilesh-0608/nc-3d-world-amazon>, live on GitHub Pages at
  <https://nilesh-0608.github.io/nc-3d-world-amazon/>.
- `prompt.md` — the prompts the project was built from, the verification protocol, and a tuning
  table. Written so the process can be replicated.
- `LICENSE` — MIT, inherited.
- Measured performance on an RTX 4060 Ti at 2550×1214, full resolution: 3.93–9.63 ms GPU across
  the six viewpoints, against an 11.7 ms setpoint.

**Absences future work must not fabricate:** there are no users, no testimonials, no traffic, no
benchmarks beyond the single machine above, and no testing on phones or integrated graphics yet —
despite mobile being in scope.

## Product Principles

1. **The world is the product.** Interface recedes; anything on screen that is not the forest
   earns its place or goes.
2. **Arrive without instructions.** A visitor who reads nothing should still end up flying
   through a forest within seconds.
3. **One file, no exceptions.** Every feature is weighed against the bundle and against the
   procedural rule. Convenience is not a reason to break either.
4. **Degrade, never fail.** Weak hardware gets less world, not a broken one. The same applies to
   the start screen before WebGPU is confirmed.
5. **Honest lineage.** The parent project is credited, and how this was made is documented rather
   than implied.

## Accessibility & Inclusion

No product-specific standard has been established. Two facts are known and should constrain
future work: the experience is entirely visual with no non-visual equivalent, and it depends on
mouse-look plus keyboard, with touch support described by its parent as experimental. Mobile is
in scope per the confirmed audience, so touch controls and the Low/Medium detail levels are
load-bearing and currently untested.
