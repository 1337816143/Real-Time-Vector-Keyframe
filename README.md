# Real-Time Vector Keyframe

A browser-based realtime VFX studio where hand landmarks directly manipulate GPU-composited vector masks.

The product goal is not a web clone of a traditional video editor. The interaction model is:

**camera → hand tracking → gesture state machine → vector mask → GPU effect composite → recording**

## v0.1 MVP baseline

This repository currently implements the first working realtime foundation:

- Browser camera capture with front/back camera switching.
- Mirrored front-camera mode and aspect-correct `cover` mapping.
- MediaPipe Hand Landmarker with up to two hands.
- Independent tracking and rendering loops: tracking is throttled, WebGL rendering stays on `requestAnimationFrame`.
- Explicit gesture states: `IDLE`, `HOVER`, `PINCH_START`, `GRABBED`, `DRAGGING`, `TWO_HAND_TRANSFORM`, `RELEASE`, `LOST`.
- Pinch hysteresis to avoid repeated grab/release flicker.
- Tracking-loss tolerance before release.
- Pinch grab + drag with velocity-aware smoothing.
- Two-hand scale and rotation using aspect-correct screen geometry.
- Swipe left/right to cycle effect presets.
- Real WebGL2 mask composition; the VFX layer is not a DOM element and does not use CSS `clip-path` for the core effect.
- Procedural Circle, Blob and Portal masks.
- Vector Trail / Vector Slash mode generated from hand movement.
- Velocity-reactive deformation, RGB split, ripple, distortion and edge glow.
- Alternate image/video upload for the world behind the mask.
- Freeze World preset using a captured camera frame.
- Presets: Multiverse Portal, Cyber Reality, Dream Window, Freeze World and Vector Slash.
- Canvas recording with `MediaRecorder`; Studio controls/debug overlays are excluded from the exported video.
- 21-landmark tracking debug overlay and realtime telemetry HUD.
- Adaptive render-resolution reduction when sustained FPS drops.
- Desktop control panel and mobile bottom-sheet style layout.
- Local-first camera processing UI notice.

## Interaction

1. Enter Studio and allow camera access.
2. Show one hand.
3. Pinch thumb + index finger near the mask.
4. Keep pinching and move to drag the mask.
5. Pinch with two hands to scale/rotate.
6. Release to let go.
7. Swipe quickly left/right while not pinching to switch presets.
8. Choose **Vector Slash** to draw a mask path through space while pinching.
9. Upload an image/video as the alternate world behind compatible presets.
10. Use Record to capture the final WebGL composite.

## Architecture

```text
React UI / project state
        ↓
Realtime loop (requestAnimationFrame)
        ├── Camera video
        ├── HandTracker (MediaPipe, ~20–30 FPS)
        │       ↓
        ├── GestureController / state machine
        │       ↓
        └── VfxRenderer (WebGL2 / GLSL, display FPS)
                ├── camera texture
                ├── alternate texture
                ├── procedural vector mask SDF
                ├── effect processing
                ├── mask composite
                └── edge / cursor FX
```

React is intentionally not used as the per-frame motion transport. High-frequency gesture/mask state lives in mutable realtime engine objects; React only handles Studio controls and low-frequency telemetry.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Camera access requires a secure context in normal browser deployment (`https://` or localhost).

## Main source files

```text
src/
├── App.tsx                    Landing / Studio entry
├── components/
│   └── Studio.tsx             Camera lifecycle, realtime orchestration, UI, recording
└── engine/
    ├── handTracking.ts        MediaPipe initialization + landmark/display mapping
    ├── gesture.ts             Pinch/drag/two-hand/swipe state machine
    ├── renderer.ts            WebGL2 textures, shaders, mask/effect composite
    └── types.ts               Runtime data models + presets
```

## Deliberately not faked in v0.1

The following items from the full product specification are **not presented as completed yet** and should be implemented in later phases rather than represented by placeholder buttons:

- Editable Bezier anchor/control handles.
- Multi-mask scene graph with independent stacks.
- Fully reorderable Effect Stack / blend-mode graph.
- Temporal ring-buffer effects such as true 500–2000 ms Time Window and multi-frame Echo.
- Keyframe timeline, replay, reverse and ping-pong.
- Motion Recording serialization.
- Effect Carousel / authored sequence editor.
- Advanced edge families such as fire, ice, particle, scanner and electric arcs.
- Full project preset import/export schema UI.
- WebGPU enhancement path and worker/offscreen split.

These are the next layers to add after the camera → hand → gesture → GPU mask loop is proven stable on real devices.

## Implementation priority

The next recommended milestone is **v0.2 — temporal + motion system**:

1. GPU frame-history ring buffer.
2. True Time Window / Echo / After Image.
3. Record Motion event stream.
4. Keyframe generation from gesture motion.
5. Replay / Loop / Reverse / Ping Pong.
6. Trail lifetime, expansion, closure and burst behaviors.
7. Performance/device profiling on Android Chrome, iOS Safari and desktop Chromium.
