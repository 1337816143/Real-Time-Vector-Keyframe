# Real-Time Vector Keyframe

A browser-based realtime VFX studio where hand landmarks manipulate GPU-composited vector masks.

Core interaction:

**camera → hand tracking → gesture state machine → vector / Bezier masks → per-mask GPU effect graph → temporal + multi-lane motion → recording**

## Current baseline — v0.6 Scene Motion

The project now supports both a lightweight single-mask workflow and an ordered multi-mask GPU scene with identity-preserving motion lanes. Multi-Mask is not a UI-only layer list: every visible mask receives its own source/effect/composite passes and is composited over the previous scene result. Scene Motion records each mask by stable `maskId` rather than flattening the scene into one uneditable animation.

## Camera + gesture interaction

- Browser camera capture with front/back camera switching.
- Mirrored front-camera mode and aspect-correct cover mapping.
- MediaPipe Hand Landmarker with up to two hands.
- Tracking inference is throttled independently from the WebGL render loop.
- Gesture FSM: `IDLE`, `HOVER`, `PINCH_START`, `GRABBED`, `DRAGGING`, `TWO_HAND_TRANSFORM`, `RELEASE`, `LOST`.
- Pinch hysteresis and short tracking-loss tolerance.
- Velocity-aware drag smoothing.
- Two-hand position / scale / rotation.
- Swipe preset switching in the single-mask workflow.
- In Scene mode the selected, unlocked mask reuses the same `GestureController`.
- Only the selected Scene mask receives live Hover / velocity / gesture-reactive VFX; unselected masks remain visually stable.
- During Scene Motion playback, live gesture transforms are suspended so playback and the user's hand do not fight over the same transform.

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

## Multi-Mask Scene Graph

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
- new masks spawn at staggered positions rather than directly overlapping at center;
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

## v0.6 Scene Motion

Scene Motion adds a second motion system specifically for multi-mask scenes. It is separate from the legacy single-mask `MotionRecorder` so older projects and workflows remain valid.

### Identity-preserving lanes

Each mask owns one lane identified by stable `maskId`.

Recorded per lane:

- position;
- scale;
- rotation;
- visibility / lock state;
- RGB Split / Ripple / Pixelate / Distortion / Glow;
- Temporal mode / delay / mix;
- Effect Stack order and node state;
- Effect node intensity / opacity / blend mode;
- geometry kind;
- Custom Bezier anchors;
- Custom incoming / outgoing handles;
- linked/free handle state;
- Custom Feather;
- Custom Expansion.

The recorder automatically emits sparse keyframes only when a node changes meaningfully, plus periodic safety keys so timing is preserved through static sections.

### Interpolation

During Scene Motion playback:

- position / scale interpolate numerically;
- rotation uses shortest-path angular interpolation;
- numeric Effect parameters interpolate;
- compatible Effect Stack nodes interpolate Intensity / Opacity while discrete state switches at the nearest side;
- Custom Feather / Expansion interpolate;
- Custom Bezier anchors and handles interpolate when both keyframes have matching anchor IDs/topology;
- if the user added/deleted anchors between keyframes, topology switches safely at the nearest keyframe rather than force-matching unrelated points.

### Playback + timeline

Scene Motion supports:

- Once
- Loop
- Reverse
- Ping Pong
- multi-lane visual timeline
- per-lane keyframe markers
- shared playhead
- click / drag Scrub preview
- duration / keyframe telemetry

Scrubbing evaluates the same lane sampling/interpolation logic used by playback.

### Topology protection

While Scene Motion is recording or playing, Scene structure is intentionally treated as fixed:

- Add Mask is disabled.
- Delete Mask is disabled.
- Layer reorder is disabled.
- Scene-mode disable is blocked.

Authored/keyframeable properties such as transforms, Effects and Custom geometry remain editable during recording.

This prevents `maskId` lanes from being invalidated by mid-record structural edits.

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

Scene mode currently prioritizes deterministic ordered multi-mask compositing and does not yet run independent transition timelines for each Scene node.

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

## Single-mask Motion Recording

The original single-mask Motion system remains available and records transform, mask type, Effect settings/stack, Temporal settings, gesture state, velocity and interaction point.

Playback:

- Once
- Loop
- Reverse
- Ping Pong

A scrubbable timeline evaluates the same interpolation path as playback.

## Project JSON

Project import/export remains schema version 1 and is backward-compatible with older v0.3/v0.4/v0.5 files.

It stores:

- single-mask preset/type/transform;
- Vector Trail release mode;
- Custom Bezier anchors/handles;
- single-mask Feather / Expansion;
- ordered Effect Stack;
- Temporal settings;
- Carousel / transition settings;
- single-mask Motion Track / keyframes;
- optional Multi-Mask Scene Graph;
- Scene enabled state;
- node ordering / selection;
- per-node visibility / lock;
- per-node transform;
- per-node geometry;
- per-node Effects / Effect Stack;
- per-node Custom Bezier / Feather / Expansion;
- **Scene Motion template Scene**;
- **Scene Motion lanes keyed by `maskId`**;
- **Scene Motion keyframes**.

Imported Scene Motion is locally validated and bounded:

- maximum four lanes;
- lane IDs must match the saved template Scene;
- per-lane keyframe count is capped;
- transforms / Effects / Bezier values are range-sanitized;
- invalid lanes are dropped rather than guessed.

Files without Custom geometry, Scene Graph or Scene Motion fields receive safe defaults. Imported scenes are repaired to keep at least one visible layer.

Uploaded image/video binary data is intentionally not embedded in JSON.

## Recording

- `canvas.captureStream()` + `MediaRecorder`.
- Records the final WebGL canvas.
- Includes masks, Temporal FX, Effect Stacks, Custom SDF geometry, Multi-Mask scene compositing and Scene Motion playback.
- Studio UI/debug overlays are excluded.

## Architecture

```text
React controls
    │
    ├── ScenePanel
    │       ├── Scene Store
    │       ├── selected-mask EffectStackEditor
    │       ├── selected Custom BezierMaskEditor
    │       └── SceneMotionControls
    │               └── multi-lane SceneMotionTimeline
    │
    ├── CustomMaskOverlay (single-mask mode)
    │       └── Bezier Store
    │
    └── Studio realtime loop
            ├── HandTracker
            ├── GestureController
            │       └── Scene gesture adapter
            ├── VectorTrail
            ├── single-mask MotionRecorder
            ├── SceneMotionRecorder
            │       ├── sparse per-mask lanes
            │       └── Scene playback sampler
            └── VfxRenderer
                    ├── camera / alternate textures
                    ├── camera-history ring
                    ├── source pass
                    ├── per-mask ordered Effect Stack
                    ├── scene accumulation RT A / B
                    ├── procedural / trail / custom SDF
                    └── final recordable canvas
```

High-frequency Scene transforms and Scene Motion playback are written into the realtime Scene Store without forcing React to rerender on every animation frame. React handles authored configuration, selection and low-frequency control state.

## Main source files

```text
src/
├── App.tsx
├── components/
│   ├── Studio.tsx
│   ├── ScenePanel.tsx
│   ├── SceneMotionControls.tsx
│   ├── SceneMotionTimeline.tsx
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
    ├── sceneInteractionRuntime.ts
    ├── sceneRuntime.ts
    ├── sceneMotion.ts
    ├── sceneMotionRuntime.ts
    ├── sceneMotionEvents.ts
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

- manual editing/deleting of individual Scene Motion keyframes;
- editable easing curves per lane/keyframe;
- independent per-Scene-node transition timelines;
- Vector Trail as a persistent Scene Graph node;
- authored Effect Sequence editor with explicit time ranges;
- advanced Edge FX families such as electric arcs, fire, ice, particles and scanner;
- WebGPU enhancement path;
- Web Worker / OffscreenCanvas renderer split;
- full real-device profiling matrix across Android Chrome, iOS Safari and desktop Chromium.

## Next milestone — v0.7 Timeline Editing + Edge FX

1. Add selectable Scene Motion keyframes and delete/update operations.
2. Add per-segment easing metadata and interpolation curves.
3. Add Scene Motion track trimming / in-out ranges.
4. Introduce GPU Edge FX families without folding them back into one fixed shader.
5. Start with Scanner / Electric / Particle edge styles, then evaluate Fire / Ice cost.
6. Profile 1 / 2 / 3 / 4-mask GPU cost on Android Chrome, iOS Safari and desktop Chromium before increasing scene complexity.
