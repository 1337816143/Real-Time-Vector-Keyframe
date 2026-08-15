# Real-Time Vector Keyframe

A browser-based realtime VFX studio where hand landmarks manipulate GPU-composited vector masks.

Core interaction:

**camera → hand tracking → gesture state machine → vector mask → GPU effect graph → temporal/motion system → recording**

## Current baseline — v0.4 Vector Mask Editor

The project now has a working realtime foundation plus the first editable vector-mask workflow. The editor is not a decorative SVG layer: its curve is sampled and fed into the WebGL mask composite used by the final recordable canvas.

### Camera + gesture interaction

- Browser camera capture with front/back camera switching.
- Mirrored front-camera mode and aspect-correct cover mapping.
- MediaPipe Hand Landmarker with up to two hands.
- Tracking inference is throttled independently from the WebGL render loop.
- Gesture FSM: `IDLE`, `HOVER`, `PINCH_START`, `GRABBED`, `DRAGGING`, `TWO_HAND_TRANSFORM`, `RELEASE`, `LOST`.
- Pinch hysteresis and short tracking-loss tolerance.
- Velocity-aware drag smoothing.
- Two-hand position / scale / rotation.
- Swipe preset switching.

### GPU mask composite

The core mask is rendered in WebGL2 / GLSL rather than CSS `clip-path`.

Current masks:

- Circle
- Blob
- Portal
- Vector Trail / Vector Slash
- **Custom closed Bezier mask**

The Custom Mask uses the same transform path as the existing realtime masks, so hand gestures still move, scale and rotate the whole shape while the editor controls its local geometry.

### v0.4 Custom Bezier mask editor

The Studio now exposes a dedicated Custom Mask editor overlay.

- Cubic Bezier anchor model.
- Two control handles per anchor.
- Linked handles for mirrored tangency.
- Free handles for asymmetric corners.
- Drag anchors directly.
- Drag incoming / outgoing control handles.
- Add anchors with de Casteljau curve splitting so insertion preserves the existing shape.
- Delete anchors while keeping a minimum valid closed curve.
- Reset to the default closed curve.
- Maximum anchor count keeps realtime editing predictable on mobile.

#### Freehand → editable curve

The Draw mode is not stored as a dense raw stroke.

1. Capture the freehand silhouette locally.
2. Distance-filter redundant samples.
3. Resample the closed path by arc length.
4. Convert it to roughly 4–8 editable anchors.
5. Estimate tangent handles from neighboring points.
6. Continue editing the resulting cubic curve normally.

This keeps the result both lightweight and editable.

#### WebGL custom-mask path

The Bezier curve is sampled to at most 64 boundary points for the renderer. GLSL then computes:

- local mask-space transform;
- nearest boundary-segment distance;
- point-in-polygon inside/outside classification;
- signed distance approximation for feathered compositing and edge glow.

The Custom Mask therefore works with the existing:

- alternate world source;
- Time Window / Echo / After Image;
- ordered Effect Stack;
- edge glow;
- mask inversion;
- preset transitions;
- final canvas recording.

### True temporal VFX

The renderer owns a real camera-history texture ring.

- 15 historical textures.
- Approximately 150 ms capture interval.
- Roughly 2 seconds of history after warm-up.
- Time Window.
- Echo.
- After Image.
- Adjustable history delay and temporal mix.

### Ordered Effect Stack

Each enabled effect node is a real WebGL render pass using ping-pong render targets.

Current nodes:

- RGB Split
- Ripple
- Pixelate
- Distortion

Per-node controls:

- Enable / Disable
- Reorder
- Intensity
- Opacity
- Blend Mode: Normal / Add / Screen / Multiply

Effect order materially changes the rendered output.

### GPU transitions + Carousel

Preset changes snapshot the previous processed GPU texture and transition to the new result in the final render path.

Transitions:

- Cross Fade
- Directional Wipe
- Glitch
- Flash
- Liquid

The same transition system is used for manual changes, swipe changes and automatic Carousel playback.

### Vector Trail lifecycle

Vector Trail is an independent realtime engine with:

- timestamped points;
- distance-based resampling;
- fast-motion point insertion;
- path smoothing;
- velocity-derived width;
- predictable point cap;
- Motion Replay reconstruction.

Release modes:

- Hold
- Dissipate
- Close
- Expand
- Burst
- Shrink

### Motion Recording + automatic keyframes

Motion capture is separate from final video capture.

Recorded state includes transform, mask type, Effect settings/stack, Temporal settings, gesture state, velocity and interaction point.

Playback:

- Once
- Loop
- Reverse
- Ping Pong

The Motion panel also provides a scrubbable visual timeline that evaluates the same interpolation path as playback.

### Project JSON

Project import/export stores:

- preset;
- mask type and transform;
- Vector Trail release mode;
- **Custom Bezier anchors and handles**;
- ordered Effect Stack;
- Temporal settings;
- Carousel / transition settings;
- Motion Track and keyframes.

Older v0.3 project files without `customCurve` remain valid and fall back to the default Bezier shape.

Uploaded image/video binary data is intentionally not embedded in project JSON.

### Final video recording

- `canvas.captureStream()` + `MediaRecorder`.
- Records the final WebGL composite.
- Includes masks, temporal FX, Effect Stack and GPU transitions.
- UI/debug overlays are excluded.

## Architecture

```text
React controls
    │
    ├── CustomMaskOverlay
    │       └── BezierMaskEditor
    │               └── Bezier store
    │
    └── Studio realtime loop
            ├── HandTracker
            ├── GestureController
            ├── VectorTrail
            ├── MotionRecorder
            └── VfxRenderer
                    ├── current camera texture
                    ├── camera-history ring
                    ├── temporal source pass
                    ├── ordered Effect Stack
                    ├── GPU transition snapshot
                    ├── procedural / trail / custom mask SDF
                    └── final recordable canvas
```

High-frequency motion stays out of React state. The Bezier editor changes authored geometry at UI frequency; the renderer samples the shared curve state only for the realtime mask boundary it needs.

## Main source files

```text
src/
├── App.tsx
├── components/
│   ├── Studio.tsx
│   ├── CustomMaskOverlay.tsx
│   ├── BezierMaskEditor.tsx
│   ├── EffectStackEditor.tsx
│   ├── MotionTimeline.tsx
│   └── ProjectControls.tsx
└── engine/
    ├── handTracking.ts
    ├── gesture.ts
    ├── bezier.ts
    ├── bezierStore.ts
    ├── customMaskRuntime.ts
    ├── motion.ts
    ├── project.ts
    ├── trail.ts
    ├── renderer.ts
    └── types.ts
```

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Camera access requires `https://` or localhost in normal browser deployment.

## Still intentionally not faked

The following remain future work rather than placeholder UI:

- Per-mask Feather / Expansion controls.
- Multi-mask scene graph with independent transforms and Effect Stacks.
- Bezier geometry keyframing over time.
- Authored effect Sequence editor with explicit time ranges.
- Advanced Edge FX families such as electric arcs, fire, ice, particles and scanner.
- WebGPU enhancement path.
- Web Worker / OffscreenCanvas renderer split.
- Full real-device profiling matrix across Android Chrome, iOS Safari and desktop Chromium.

## Next milestone — v0.4 continuation / v0.5 Multi-Mask

1. Add Feather / Expansion to Custom Mask signed-distance processing.
2. Move Custom Mask controls into the main Mask panel once the single-mask editor is stable.
3. Introduce a scene graph containing multiple mask nodes.
4. Give every mask node its own transform, geometry and Effect Stack reference.
5. Add mask selection / visibility / ordering controls.
6. Extend project JSON while preserving the current single-mask schema as a migration path.
7. Profile mobile GPU cost before increasing mask count or shader complexity.
