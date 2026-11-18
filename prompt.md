# The prompt this project was built from

**nc-3d-world-amazon** was built by prompting an AI coding agent, the same way
[Abyssal Garden](https://github.com/Noniv/abyssal-garden) was. This file is here so
anyone can replicate the process rather than just read the result.

It is honest about one thing up front: this project did **not** start from an empty
directory. It started as a fork of Abyssal Garden's source (MIT), because the renderer,
the adaptive-quality controller, the collision system, the noise and mesh helpers and
the single-file build pipeline are all setting-agnostic. What was rewritten is
`world.js` (what gets built and where) and `shaders.js` (how it looks) — which in this
codebase is the entire atmosphere, because the mood *is* shader code.

If you want to build something like this from nothing, use Prompt A.
If you want to re-skin an existing scene the way this one was, use Prompt B.

---

## Prompt A — building the engine from scratch

This is Abyssal Garden's original prompt, generalised. Credit for its structure goes to
that project; the ranked priorities and the two verification gates are the parts that
actually matter.

```
Build a real-time <SETTING> scene that runs in the browser. It only needs to look
beautiful and let me fly a free camera through it.

PRIORITIES (in this order when they conflict)
1. Visual quality
2. Stable frame pacing at the target spec
3. Small bundle size

CONSTRAINTS
- No Three.js/Babylon.js or other engines.
- WebGPU rendered.
- Everything procedural: no texture/model files. Deliverable is a single
  self-contained index.html. Report minified size.
- Zero per-frame JS allocations (no GC stutter). Preallocate all buffers.

TARGET
- <OS>, <BROWSER>, <GPU>, <CPU>, <REFRESH RATE>
- <RESOLUTION> at full resolution. GPU frame time <= 11 ms average, no frame
  > 16.7 ms during a scripted 60 s fly-through.

SCENE
- <the specific things you want to see, listed concretely>

CONTROLS
WASD move, mouse look (pointer lock), Q/E up/down, Shift to accelerate

VERIFICATION
- Visual critic: a separate subagent that sees ONLY your renders, never your code or
  reasoning. Give it 6 fixed camera poses, rendered at <RESOLUTION> in GPU-accelerated
  Chrome, plus a short recording of the fly-through to catch shimmer, aliasing,
  popping and banding. It returns prioritized, concrete defects. Iterate until it
  reports nothing above "minor".
- Performance: GPU timestamp queries plus a frame-time log from the scripted
  fly-through. Report average, 99th percentile and max.

DONE WHEN: both verification gates pass. Deliver index.html, the bundle size, the
perf report and the critic's final review.
```

**Why this prompt works.** Three things do the heavy lifting:

1. **Ranked priorities**, so the agent can resolve conflicts without asking.
2. **A named target machine**, so "fast enough" is a number, not a feeling.
3. **A blind visual critic.** An agent grading its own renders grades its intent. An
   agent that sees only pixels grades what shipped. This is what catches shimmer,
   popping and floating geometry — defects no test suite describes.

---

## Prompt B — re-skinning an existing scene

This is what actually produced nc-3d-world-amazon. Give the agent the architecture it is
inheriting so it does not waste a third of its budget rediscovering it.

```
Convert a procedural WebGPU <OLD SETTING> scene into <NEW SETTING>.
Project: <path>. Build with `npm run build`; it currently builds green at <size>.
IT MUST STILL BUILD GREEN WHEN YOU FINISH.

This is a THROWAWAY SPIKE to see whether <NEW SETTING> feels right. Minimal viable,
not polished. Do not gold-plate.

== ARCHITECTURE YOU ARE INHERITING (do NOT re-derive, this is confirmed) ==
<the real structure: file order, shared scope, the density field, the scatter idiom,
 the instance byte layouts, how animation works, what is baked once vs per frame>

== WHAT TO BUILD ==
<the new setting, and explicitly: which old effects PORT DIRECTLY and which must be
 REPLACED>

== THE ONE THING THAT DOES NOT PORT ==
<name it, and say why it changes the design>

== CONSTRAINTS ==
- Change ONLY <these files>. Do NOT restructure the renderer, the pass list, the
  culling, or the build.
- Keep instance byte layouts EXACTLY as they are, or you must update the pipeline
  descriptors too.
- Everything stays procedural. No asset files.
- Keep it building. Run `npm run build` and confirm before reporting.

== REPORT ==
What changed per file, the new tuning constants and where to tune them, what the
viewpoints now show, what you deliberately left out, and anything you are unsure
about. Be honest about parts you expect to look wrong.
```

### The part that made the difference

For the ocean → rainforest conversion, the single most useful paragraph in the brief
was naming **what does not port**:

> Underwater, distance reads as **colour loss** — red dies first, so the sea is sparse
> and vast and fog hides everything far away. In a forest, distance reads as
> **occlusion** — you see 30 m because leaves block you, not because air eats light.
> So the jungle must be dense and close, draw distance drops, vegetation density near
> the camera rises, and height drives the lighting: dim green at the floor, shafts in
> the mid-storey, blazing sun above the canopy.

Everything else was a mapping that transferred almost unchanged:

| Ocean | Forest | Status |
|---|---|---|
| God rays through the water surface | God rays through canopy gaps | same shader, new occluder |
| Caustics projected along the sun | Dappled leaf-shadow on the floor | same projection trick |
| Water surface seen from below | Canopy ceiling with real holes | same quad, `discard` for gaps |
| Kelp columns | Buttressed trunks, lianas | same instancing |
| Marine snow | Pollen motes | recoloured |
| Fish schools | Butterflies | same closed-form orbits |
| Manta rays | Soaring birds | same wing animation |
| Bubbles (unused) | Fireflies and gnat swarms | dead pass repurposed |

---

## Verification, concretely

Prompt A asks for a blind visual critic. Here is the protocol that was actually used,
which you can run by hand:

1. `npm run build` exits 0 and prints a size line.
2. `navigator.gpu.requestAdapter()` returns non-null **before** judging anything.
3. Page does not land in its error state.
4. Console is clean — WGSL compile errors surface there, not on screen.
5. Visit all 6 viewpoints with **real** keypresses, screenshot each.
6. Read fps / worst frame / GPU ms / resolution % at each.
7. `npm run build:dev` → `dev.html` → press `B` for the scripted flythrough
   benchmark. It pins resolution so the adaptive loop cannot flatter the result.
8. Low / Medium / High all load.
9. Camera is never inside geometry at any viewpoint.
10. Reload produces an identical world (the RNG is seeded).

### Three traps that produce confident garbage

- **Viewpoint keys are ignored while the menu is open.** A sweep run from the menu
  samples one viewpoint six times and reports it as six.
- **Synthetic `KeyboardEvent`s do not work.** Losing pointer lock reopens the menu, and
  synthetic events cannot re-acquire it. Drive real input.
- **Cold start lies.** The first ~60 s is shader compilation and terrain generation; it
  reports single-digit fps and triple-digit GPU times. Discard it. An unfocused window
  also throttles to exactly 1 Hz while still reporting `visibilityState: "visible"` —
  check the rAF interval before believing a slow number.

---

## Where to tune what

| Want to change | Edit |
|---|---|
| Sun angle | `SUN` (main.js) **and** `SUNX`/`SUNZ` (world.js) together — `SUNX = x/y`, `SUNZ = z/y` |
| Time-of-day mood | `SUNC`, `SKYC`, `HAZE_LO/MID/HI`, `AMB_LO/HI`, `SHAFT`, `RAYK` (shaders.js) |
| Haze density | `HZ0` (at floor), `HZB` (thinning with height) |
| Canopy height | `CAN` — first constant in shaders.js |
| Canopy hole density | `W_WATER` threshold and radius |
| Clearings | `GAPS` (world.js) |
| Firefly brightness / blink | `FF_GAIN`, `FF_POW` |
| Gnat brightness | `GN_GAIN` |
| Insect counts | `FIREFLIES`, `SWARM`, `SWARMS` (world.js) |
| Exposure | `EXPO` (main.js) |

Changing the sun direction regenerates the world, because clearing placement depends
on it. Changing colours does not.

---

## Credit

Built on [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian
Dendura, MIT licensed. The renderer, the adaptive-resolution controller, the
brick-sparse SDF collision, the surface-nets terrain, the instancing and the
single-file build are all its work. The prompt structure above — ranked priorities,
a named target machine, and a blind visual critic — is the genuinely transferable
idea, and it is worth stealing for any project of this kind.

MIT, same as its parent.
