# Real-Time Vector Keyframe

A browser-based realtime VFX studio where hand landmarks manipulate GPU-composited vector masks.

Core interaction:

**camera → hand tracking → gesture state machine → vector / Bezier masks → per-mask GPU effect graph → temporal/motion system → recording**

## Current baseline — v0.5 Multi-Mask Scene

The project now supports both a lightweight single-mask workflow and a real ordered multi-mask GPU scene. Multi-Mask is not a UI-only layer list: every visible mask receives its own source/effect/composite passes and is composited over the previous scene result.

### Camera + gesture interaction

- Browser camera capture with front/back camera switching.
- Mirrored front-camera mode and aspect-correct cover mapping.
- MediaPipe Hand Landmarker with up to two hands.
- Tracking inference is throttled independently from the WebGL render loop.
- Gesture FSM: `IDLE`, `HOVER`, `PINCH_START`, `GRABBED`, `DRAGGING`, `TWO_HAND_TRANSFORM`, `RELEASE`, `LOST`.
- Pinch hysteresis and short tracking-loss tolerance.
- Velocity-aware drag smoothing.
- Two-hand position / scale / rotation.
- Swipe preset switching in the single-mask workflow.
- In Scene mode the selected, unlocked mask reuses the same GestureController, so pinch / drag / two-hand transform manipulates that node rather than introducing a second gesture system.

## GPU masks

The mask composite is rendered in WebGL2 / GLSL rather than CSS `clip-path`.

Single-mask modes:

- Circle
- Blob
- Portal
- Vector Trail / Vector Slash
- Custom closed Bezier mask

Scene-node geometry currently supports:

- Circle
- Blob
- Portal
- Custom Bezier

Vector Trail remains available in the single-mask realtime/motion workflow and is not yet a persistent Scene Graph geometry type.

## Custom Bezier editor

The SVG editor is only the authoring surface. The authored curve is sampled and fed into the same WebGL mask composite used by the final recordable canvas.

- Cubic Bezier anchors.
- Incoming / outgoing handles.
- Linked tangency or asymmetric Free handles.
- Anchor dragging.
- Handle dragging.
- de Casteljau insertion that preserves the current curve when adding a point.
- Minimum three-anchor closed curve.
- Reset to default geometry.
- Local mask coordinates, so global hand transform stays separate from shape editing.

### Freehand → editable curve

Draw mode converts a quick silhouette into a compact editable curve:

1. capture freehand samples locally;
2. remove redundant near-duplicate points;
3. resample the closed polyline by arc length;
4. reduce it to roughly 4–8 anchors;
5. estimate smooth tangent handles from neighboring points;
6. continue editing the resulting cubic curve.

Dense input strokes are therefore not stored as hundreds of permanent control points.

### Signed-distance Custom Mask

A Bezier curve is sampled to at most 64 boundary points for realtime rendering. GLSL computes:

- local transform;
- nearest boundary-segment distance;
- point-in-polygon inside/outside classification;
- signed distance approximation;
- **Expansion** by directly offsetting the SDF zero contour;
- **Feather** by changing the actual SDF blend band.

Expansion and Feather are therefore not CSS blur/scale substitutes. Edge glow follows the shifted signed-distance boundary as well.

## v0.5 Multi-Mask Scene Graph

Scene mode currently supports up to four mask nodes so mobile GPU cost remains bounded while the architecture is proven.

Each node owns:

- stable mask ID;
- display name;
- visibility;
- gesture-transform lock;
- independent position / scale / rotation;
- independent geometry;
- independent Effect settings;
- independent ordered Effect Stack;
- for Custom nodes: independent Bezier curve, Feather and Expansion.

Scene controls:

- enable / disable Scene mode;
- select active mask;
- add Circle / Blob / Portal / Custom masks;
- delete masks while keeping at least one node;
- show / hide nodes while keeping at least one visible layer;
- lock / unlock gesture transform;
- move layer up / down;
- apply an Effect preset per mask;
- tune RGB Split, Ripple, Pixelate, Distortion and Edge Glow per mask;
- reorder / enable / disable Effect Stack nodes per mask;
- adjust per-effect Intensity, Opacity and Blend Mode;
- fully edit Custom geometry inside the selected scene node.

### Scene GPU pipeline

For N visible masks the renderer performs the equivalent of:

```text
Camera / History / Alternate media
        ↓
Mask 1 Source Pass
        ↓
Mask 1 ordered Effect Stack
        ↓
Mask 1 Composite → Scene RT A
        ↓
Mask 2 Source Pass
        ↓
Mask 2 ordered Effect Stack
        ↓
Composite over Scene RT A → Scene RT B
        ↓
...
        ↓
Last Mask Composite → final canvas
```

The existing effect ping-pong targets are separate from the scene accumulation render targets. Scene composition is therefore not implemented as DOM opacity layers or multiple HTML canvases.

The final result still lands on the same WebGL canvas used by `MediaRecorder`, so Multi-Mask output is included in recordings.

## Temporal VFX

The renderer owns a real camera-history texture ring:

- 15 historical textures;
- approximately 150 ms capture interval;
- roughly 2 seconds of warmed history;
- Time Window;
- Echo;
- After Image;
- adjustable history delay and temporal mix.

In Scene mode every mask node carries its own Effect settings, including Temporal configuration, while sharing the camera-history pool.

## Ordered Effect Stack

Every enabled Effect node is a real WebGL pass using ping-pong render targets.

Current Effect nodes:

- RGB Split
- Ripple
- Pixelate
- Distortion

Per-effect controls:

- Enable / Disable
- Reorder
- Intensity
- Opacity
- Blend Mode: Normal / Add / Screen / Multiply

Effect ordering materially changes the rendered output. Scene masks each own their own stack.

## GPU transitions + Carousel

Single-mask preset changes can snapshot the previous processed GPU texture and transition into the new result.

Transitions:

- Cross Fade
- Directional Wipe
- Glitch
- Flash
- Liquid

The same transition system is used for manual preset changes, swipe changes and automatic Carousel playback.

Scene mode currently prioritizes deterministic ordered multi-mask compositing and does not yet run independent transition timelines for each scene node.

## Vector Trail lifecycle

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

## Motion Recording + automatic keyframes

The existing single-mask Motion system records transform, mask type, Effect settings/stack, Temporal settings, gesture state, velocity and interaction point.

Playback:

- Once
- Loop
- Reverse
- Ping Pong

A scrubbable timeline evaluates the same interpolation path as playback.

**Scene-wide multi-mask keyframing is not claimed as complete yet.** Scene nodes render and respond to live gesture selection, but recording simultaneous independent node timelines is a later milestone.

## Project JSON

Project import/export remains schema version 1 and is backward-compatible with older v0.3/v0.4 files.

It now stores:

- single-mask preset/type/transform;
- Vector Trail release mode;
- Custom Bezier anchors/handles;
- single-mask Feather / Expansion;
- ordered Effect Stack;
- Temporal settings;
- Carousel / transition settings;
- Motion Track / keyframes;
- **optional Multi-Mask Scene Graph**;
- Scene enabled state;
- node ordering / selection;
- per-node visibility / lock;
- per-node transform;
- per-node geometry;
- per-node Effects / Effect Stack;
- per-node Custom Bezier / Feather / Expansion.

Files without `customCurve`, Feather/Expansion or `scene` fields receive safe defaults. Imported scenes are validated, capped to four nodes and repaired to keep at least one visible layer.

Uploaded image/video binary data is intentionally not embedded in JSON.

## Recording

- `canvas.captureStream()` + `MediaRecorder`.
- Records the final WebGL canvas.
- Includes masks, Temporal FX, Effect Stack, Custom SDF geometry and Multi-Mask scene compositing.
- Studio UI/debug overlays are excluded.

## Architecture

```text
React controls
    │
    ├── ScenePanel
    │       ├── Scene Store
    │       ├── selected-mask EffectStackEditor
    │       └── selected Custom BezierMaskEditor
    │
    ├── CustomMaskOverlay (single-mask mode)
    │       └── Bezier Store
    │
    └── Studio realtime loop
            ├── HandTracker
            ├── GestureController
            │       └── Scene gesture adapter when Scene mode is active
            ├── VectorTrail
            ├── MotionRecorder
            └── VfxRenderer
                    ├── camera / alternate textures
                    ├── camera-history ring
                    ├── source pass
                    ├── per-mask ordered Effect Stack
                    ├── scene accumulation RT A / B
                    ├── procedural / trail / custom SDF
                    └── final recordable canvas
```

High-frequency Scene transforms are updated silently in the realtime store rather than pushed through React every animation frame. React handles authored configuration, selection and low-frequency control state.

## Main source files

```text
src/
├── App.tsx
├── components/
│   ├── Studio.tsx
│   ├── ScenePanel.tsx
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
    ├── scene.ts
    ├── sceneStore.ts
    ├── sceneGestureRuntime.ts
    ├── sceneRuntime.ts
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

- Multi-mask Motion Track / geometry keyframing.
- Keyframed Bezier anchor/handle animation.
- Independent per-scene-node transition timelines.
- Vector Trail as a persistent Scene Graph node.
- Authored Effect Sequence editor with explicit time ranges.
- Advanced Edge FX families such as electric arcs, fire, ice, particles and scanner.
- WebGPU enhancement path.
- Web Worker / OffscreenCanvas renderer split.
- Full real-device profiling matrix across Android Chrome, iOS Safari and desktop Chromium.

## Next milestone — v0.6 Scene Motion

1. Extend MotionTrack from one mask state to multiple node tracks.
2. Record selected-mask transforms without losing independent node identities.
3. Add node-specific timeline lanes.
4. Keyframe Custom Bezier geometry with sparse change detection.
5. Add Scene playback / Loop / Reverse / Ping Pong while preserving current single-mask files.
6. Add Scene-level transitions only after timeline ownership is explicit.
7. Profile 1 / 2 / 3 / 4 mask GPU cost on Android Chrome, iOS Safari and desktop Chromium before increasing the scene cap.
