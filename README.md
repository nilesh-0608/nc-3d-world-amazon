# nc-amazon

**An Amazon rainforest you can fly through, in one 95 KB HTML file.**

Buttressed trunks, light shafts falling through gaps in the canopy, fireflies in the dark
understorey, a sky full of stars when you switch to night. No images, no 3D models, no sound
files — the whole world is generated from mathematics when the page opens.

## Try it

1. Download [`index.html`](index.html).
2. Open it in **Chrome** or **Edge** on a desktop computer.
3. Wait a few seconds while the world is built, then press **Begin survey**.

Nothing to install, and it works offline. It needs a browser with **WebGPU**, and graphics
acceleration must be enabled — in Chrome that is `chrome://settings/system` → *Use graphics
acceleration when available*.

## Controls

| | Keyboard & mouse |
|---|---|
| Look around | Move the mouse |
| Move | `W` `A` `S` `D` |
| Down / up | `Q` / `E` |
| Faster | Hold `Shift` |
| Jump to a viewpoint | `1` to `6` |
| Day / night | `N` |
| Menu | `Esc` |
| Sound on / off | `M` |
| Performance stats | `H` |
| Detail level | **Low**, **Medium** or **High** in the menu |

Start at viewpoint `6` and hold `E`. Rising through the canopy into open sky is the thing the
whole scene is built around.

## What's in there

- **Three layers you can move between freely** — a dim floor, a mid-storey of trunks and lianas,
  and the canopy top in open air above it
- **God rays** through gaps in the canopy, landing as dappled light on the forest floor — the
  shafts and the floor dapples share one sun projection, so they line up
- **Humid haze** that is thick at ground level and thins as you climb, so breaking through the
  canopy opens the view
- **Roughly two million leaves**, generated in the vertex shader with no geometry buffer at all
- **Fireflies** blinking in the understorey and **gnat swarms** hanging in the light shafts
- **Butterflies, birds, pollen** — all animated in closed form from time, with zero CPU cost
- **Day and night** on one key, with a star field above the canopy

## How it works

- The terrain is a signed density field evaluated on the GPU over 21 million voxels, then meshed
  with surface nets — which is what allows overhangs, arches and tunnels rather than a heightmap.
- Everything is drawn with **WebGPU** directly. No game engine, no 3D library.
- Vegetation is scattered by rejection-sampling the terrain's own vertices, so every plant sits
  on the surface with a correct normal and no raycast is needed.
- Creatures move along closed-form paths derived from time, with headings taken from the analytic
  derivative. Nothing is simulated per frame.
- Sound is synthesized live with the Web Audio API.
- It targets 11 ms of GPU time and holds 60 fps by lowering first the resolution, then how far
  plants and rocks are drawn. On an RTX 4060 Ti at 2550×1214 it runs at 3.9–9.6 ms.

## Build it yourself

The readable source is in [`source`](source). You need [Node.js](https://nodejs.org) 18+:

```bash
cd source
npm install
npm run build
```

This writes a new `index.html` next to this README. `npm run build:readable` writes an
unminified version. `npm run build:dev` writes `dev.html` with two extra tools: `F` flies the
camera along a scripted path, and `B` runs that flight as a benchmark.

| File | What's inside |
|---|---|
| [`source/src/world.js`](source/src/world.js) | The world: terrain, trees, lianas, clearings, creatures. **Start here.** |
| [`source/src/shaders.js`](source/src/shaders.js) | The look: haze, light, canopy, leaves, day/night (WGSL) |
| [`source/src/main.js`](source/src/main.js) | Renderer, camera, controls, viewpoints |
| [`source/src/math.js`](source/src/math.js) | Noise, random numbers, mesh helpers |
| [`source/src/audio.js`](source/src/audio.js) | The soundscape |
| [`source/template.html`](source/template.html) | The page around the scene |

[`prompt.md`](prompt.md) has the prompts this was built from, the verification protocol, and a
table of what to tune where.

## Credit

Built on **[Abyssal Garden](https://github.com/Noniv/abyssal-garden)** by Maksymilian Dendura,
MIT licensed — an underwater scene with the same single-file, fully-procedural constraints. Its
renderer, adaptive-resolution controller, surface-nets terrain, brick-sparse collision field and
build pipeline are all its work, and this project would have been weeks longer without them.

The ocean→forest mapping turned out to be unusually direct: god rays through the water surface
became god rays through canopy gaps, caustics on the seabed became dappled light on the forest
floor, kelp became trunks, and the unused bubble pass became fireflies. The one thing that did
not transfer is how distance reads — underwater it is colour loss, in a forest it is occlusion.
That single difference drove most of the rest.

## License

[MIT](LICENSE), same as its parent.
