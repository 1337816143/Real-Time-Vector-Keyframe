# Real-Time Vector Keyframe

A browser-based realtime VFX studio where hand landmarks directly manipulate GPU-composited vector masks.

The product goal is not a web clone of a traditional video editor. The interaction model is:

**camera → hand tracking → gesture state machine → vector mask → GPU effect composite → temporal/motion system → recording**

## Current baseline — v0.3 Vector Motion (in progress)

### Realtime interaction foundation

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
- Velocity-reactive deformation, RGB split, ripple, distortion and edge glow.
- Alternate image/video upload for the world behind the mask.
- Freeze World using a captured camera frame.
- Canvas recording with `MediaRecorder`; Studio controls/debug overlays are excluded from the exported video.
- 21-landmark tracking debug overlay and realtime telemetry HUD.
- Adaptive render-resolution reduction when sustained FPS drops.
- Desktop control panel and mobile bottom-sheet style layout.
- Local-first camera processing UI notice.

### True temporal VFX

The renderer owns a real camera-history ring buffer rather than simulating delay with one frozen frame.

- 15 historical camera textures.
- New history frame captured about every 150 ms.
- Roughly 2 seconds of live history after the buffer warms up.
- Delay selection chooses the historical texture nearest the requested timestamp.
- **Time Window**: the mask reveals a real past camera frame.
- **Echo**: current + two historical moments are composited in GLSL.
- **After Image**: current and delayed camera frames are blended in GLSL.
- Temporal delay adjustable from 150–2000 ms in Studio.
- Temporal mix adjustable for Echo / After Image.
- Temporal history depth exposed in the debug HUD.

### Motion Recording / automatic keyframes

Motion capture is separate from video capture.

- Record live mask transforms.
- Record mask type changes.
- Record effect parameters, including temporal settings.
- Record gesture state and hand velocity.
- Record the hand interaction point used by the realtime interaction layer.
- Automatically create sparse keyframes based on meaningful motion/effect changes rather than blindly storing every render frame.
- Periodic safety keyframes preserve timing through static sections.
- Interpolate position and scale during replay.
- Shortest-path interpolation for rotation.
- Interpolate numeric Effect parameters during replay.
- Replay modes: **Once**, **Loop**, **Reverse**, **Ping Pong**.
- Playback duration, keyframe count and progress exposed in Studio.

### Vector Trail / Vector Slash lifecycle

Vector Trail is now an independent realtime engine instead of a temporary point array inside the Studio component.

- Timestamped input path.
- Distance-based resampling to avoid gaps during fast swipes.
- Automatic intermediate points for long hand movements.
- Chaikin-style path smoothing before GPU rendering.
- Path point cap for predictable realtime cost.
- Velocity-derived trail width.
- Motion Replay can reconstruct Vector Slash using recorded interaction points.
- Release modes:
  - **Hold** — keep the spatial crack open.
  - **Dissipate** — erase progressively from the start while narrowing.
  - **Close** — collapse the path toward its center.
  - **Expand** — widen the crack before it disappears.
  - **Burst** — push points outward with width expansion and deterministic lateral breakup.
  - **Shrink** — reduce path width to zero.
- Release mode is selectable from the Mask panel.

### Built-in presets

- Multiverse Portal
- Cyber Reality
- Dream Window
- **Time Window**
- Freeze World
- Vector Slash

## Interaction

1. Enter Studio and allow camera access.
2. Show one hand.
3. Pinch thumb + index finger near the mask.
4. Keep pinching and move to drag the mask.
5. Pinch with two hands to scale/rotate.
6. Release to let go.
7. Swipe quickly left/right while not replaying a motion track to switch presets.
8. Choose **Time Window** to reveal the recent past through the mask.
9. Choose **Vector Slash** to draw a spatial crack; choose its release behavior in the Mask panel.
10. Open **Motion** and record a gesture performance; replay it Once / Loop / Reverse / Ping Pong.
11. Upload an image/video as the alternate world behind compatible presets.
12. Use Record to capture the final WebGL composite.

## Architecture

```text
React UI / project state
        ↓
Realtime loop (requestAnimationFrame)
        ├── Camera video
        ├── HandTracker (MediaPipe, ~20–30 FPS)
        │       ↓
        ├── GestureController / explicit state machine
        │       ↓
        ├── VectorTrail
        │       ├── resample + smoothing
        │       └── release lifecycle
        │
        ├── MotionRecorder
        │       ├── sparse keyframe capture
        │       └── interpolated playback
        │
        └── VfxRenderer (WebGL2 / GLSL, display FPS)
                ├── current camera texture
                ├── alternate media texture
                ├── 15-slot camera history ring
                ├── historical texture selection
                ├── procedural vector mask SDF
                ├── temporal/effect processing
                ├── mask composite
                └── edge / cursor FX
```

React is intentionally not used as the per-frame motion transport. High-frequency gesture, temporal, trail and mask state lives in mutable realtime engine objects; React only handles Studio controls and low-frequency telemetry.

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
│   └── Studio.tsx             Camera lifecycle, realtime orchestration, UI, video + motion recording
└── engine/
    ├── handTracking.ts        MediaPipe initialization + landmark/display mapping
    ├── gesture.ts             Pinch/drag/two-hand/swipe state machine
    ├── motion.ts              Motion capture, sparse keyframes, interpolation and playback
    ├── trail.ts               Smoothed vector path + release lifecycle engine
    ├── renderer.ts            WebGL2 history textures, shaders, mask/effect/temporal composite
    └── types.ts               Runtime data models + presets
```

## Deliberately not faked yet

The following full-product items are still intentionally **not represented by placeholder controls**:

- Editable Bezier anchor/control handles.
- Multi-mask scene graph with independent stacks.
- Fully reorderable Effect Stack / blend-mode graph.
- Motion track import/export and full project serialization UI.
- Visual keyframe timeline/editor.
- Effect Carousel / authored sequence editor.
- Advanced edge families such as fire, ice, particle, scanner and electric arcs.
- Full project preset import/export schema UI.
- WebGPU enhancement path and worker/offscreen split.

## Next milestone — v0.3 Effect Graph

Recommended implementation order:

1. Introduce ping-pong render targets for an ordered Effect Stack.
2. Make effect processing order materially change output.
3. Support enable/disable, reorder, intensity, opacity and blend-mode metadata per effect node.
4. Add Effect Carousel and cross-fade / directional / glitch transitions.
5. Add motion track JSON export/import and project serialization.
6. Add a visual keyframe timeline/editor.
7. Profile Android Chrome, iOS Safari and desktop Chromium on real devices.
