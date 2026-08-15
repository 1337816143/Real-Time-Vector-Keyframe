# Real-Time Vector Keyframe

Browser-based realtime VFX Studio where hand landmarks manipulate GPU-composited vector masks.

Core path:

```text
Camera
  → MediaPipe Hand Tracking
  → Gesture FSM
  → Vector / Bezier / Multi-Mask Scene
  → Temporal + Ordered Effect Stack
  → Scene Motion / Effect Sequence
  → Standalone Edge FX Pass
  → final WebGL canvas
  → MediaRecorder
```

## Current baseline — v0.8

The current `main` combines the original realtime gesture workflow with an editable multi-mask animation system:

- WebGL2 camera compositing and procedural/custom masks;
- MediaPipe hand tracking + explicit gesture state machine;
- Custom Bezier authoring and Freehand → editable curve conversion;
- Temporal history effects;
- ordered multi-pass Effect Stack;
- up to four independent Scene masks;
- identity-preserving Scene Motion lanes;
- editable Scene Motion keyframes, easing and retiming;
- In / Out playback ranges;
- authored Effect Sequence clips;
- standalone Neon / Scanner / Electric / Particle GPU edge pass;
- project JSON persistence;
- final-canvas WebM recording.

## Camera + gesture interaction

- Front/back browser camera switching.
- Mirrored front-camera mode.
- Aspect-correct camera cover mapping.
- MediaPipe Hand Landmarker, up to two hands.
- Tracking inference runs independently from the render loop.
- Gesture states: `IDLE`, `HOVER`, `PINCH_START`, `GRABBED`, `DRAGGING`, `TWO_HAND_TRANSFORM`, `RELEASE`, `LOST`.
- Pinch hysteresis and short tracking-loss tolerance.
- Velocity-aware drag smoothing.
- Two-hand move / scale / rotation.
- Swipe preset switching in the single-mask workflow.
- Scene mode reuses the same GestureController for the selected mask.
- During Scene Motion playback, live hand transforms are suspended so playback and the hand do not fight over the same node.

## GPU masks

The final mask is rendered in WebGL2/GLSL rather than CSS `clip-path`.

Single-mask geometry:

- Circle
- Blob
- Portal
- Vector Trail / Vector Slash
- Custom closed Bezier

Persistent Scene geometry:

- Circle
- Blob
- Portal
- Custom Bezier

Vector Trail is still a single-mask realtime/motion geometry and is not yet a persistent Scene Graph node.

## Custom Bezier + Freehand

The SVG editor is only the authoring UI. The authored curve is sampled and used by the recordable WebGL pipeline.

Supported editing:

- Cubic Bezier anchors.
- Incoming/outgoing handles.
- Linked or free tangents.
- Anchor and handle dragging.
- de Casteljau insertion that preserves the current shape.
- Closed curves with at least three anchors.
- Reset to a known default.
- Local geometry coordinates separate from global hand transform.

Freehand mode converts a rough silhouette into a compact editable curve rather than preserving hundreds of raw points:

1. collect the stroke;
2. remove near-duplicates;
3. resample by arc length;
4. reduce to a small anchor set;
5. estimate smooth tangents;
6. continue editing as Cubic Bezier geometry.

Custom masks use an SDF-like polygon approximation in GLSL. `Expansion` offsets the signed-distance boundary and `Feather` changes the boundary blend band; neither is implemented as CSS scale/blur.

## Multi-Mask Scene

Scene mode currently caps the graph at four masks so GPU cost stays bounded while the architecture is developed.

Each node owns:

- stable `maskId`;
- name;
- visibility;
- gesture-transform lock;
- independent position / scale / rotation;
- independent geometry;
- independent Effect settings;
- independent ordered Effect Stack;
- independent Edge FX settings;
- for Custom masks: independent Bezier / Feather / Expansion.

Scene controls include add/delete, selection, visibility, lock, ordering, per-node preset/effect editing and full Custom geometry editing.

Structural edits are disabled while Scene Motion is recording or playing so a `maskId` lane cannot be invalidated halfway through an animation.

### Scene GPU composition

For each visible node, the renderer runs its own source/effect/mask passes and accumulates the result through scene render targets before the last composite reaches the default framebuffer.

```text
Camera / history / alternate media
      ↓
Mask A source → ordered Effect Stack → mask composite
      ↓
Scene RT A
      ↓
Mask B source → ordered Effect Stack → composite over Scene RT A
      ↓
Scene RT B
      ↓
...
      ↓
final WebGL canvas
```

This is not implemented as DOM opacity layers or multiple visible canvases.

## Temporal FX

The renderer owns a camera-history texture ring used by:

- Time Window
- Echo
- After Image

Temporal delay and mix are per Effect settings. Scene nodes share the camera-history pool but carry independent temporal configuration.

## Ordered Effect Stack

Current texture effect nodes:

- RGB Split
- Ripple
- Pixelate
- Distortion

Each enabled node is a real WebGL pass using ping-pong render targets.

Per-node controls:

- Enable / Disable
- Reorder
- Intensity
- Opacity
- Blend Mode: Normal / Add / Screen / Multiply

Changing node order changes the texture fed to the following pass, so output is genuinely order-dependent.

## v0.7+ Editable Scene Motion

Scene Motion is separate from the original single-mask MotionRecorder so old single-mask projects remain valid.

Each Scene mask owns one lane keyed by stable `maskId`.

Recorded/keyframeable state includes:

- position / scale / rotation;
- visibility / lock;
- Effect numbers and ordered Effect Stack state;
- Temporal settings;
- Edge FX mode / speed / density;
- geometry kind;
- Custom Bezier anchors and handles;
- Custom Feather / Expansion.

### Sparse capture and interpolation

Scene Motion emits sparse keys when a node changes meaningfully, plus periodic safety keys for timing.

Interpolation includes:

- numeric transform interpolation;
- shortest-path rotation interpolation;
- numeric Effect/Temporal/Edge interpolation;
- compatible Effect Stack intensity/opacity interpolation;
- Custom Bezier anchor/handle interpolation when topology matches;
- safe nearest-side geometry switching when Bezier topology does not match.

### Keyframe editing

The multi-lane timeline now supports real key editing rather than read-only markers:

- select a key;
- drag an interior key horizontally to retime it;
- retime through the Inspector slider;
- update a selected key from the current Scene state;
- delete interior keys;
- fixed first/last boundary keys;
- per-segment easing:
  - Linear
  - Ease In
  - Ease Out
  - Ease In-Out
- Scrub through the same evaluator used by playback.

### Playback range

Scene Motion supports explicit In / Out limits. The selected range is respected by:

- Once
- Loop
- Reverse
- Ping Pong

The timeline visually shades content outside the active range.

## v0.8 Effect Sequence

Effect Sequence adds authored time-ranged VFX clips on top of Scene Motion.

Each clip owns:

- stable clip ID;
- target `maskId`;
- start/end time;
- enabled state;
- preset;
- intensity;
- Fade In;
- Fade Out;
- overlay order.

The editor can:

- preview the Scene Motion clock;
- add a clip at the playhead;
- choose the target mask;
- choose a preset;
- change Start / End;
- change Fade In / Out;
- change intensity;
- reorder, disable or delete clips.

Sequence evaluation is non-destructive: it creates render-only effective Effect settings for the target node. It does **not** rewrite transforms, geometry or stored Scene Motion keyframes.

Scene Motion Scrub and Effect Sequence preview share the same timeline time.

## Standalone Edge FX GPU pass

Advanced edge rendering is separated from the ordered texture Effect Stack.

Modes:

- Off
- Neon
- Scanner
- Electric
- Particle

Controls:

- existing Glow value = edge intensity;
- Edge Speed;
- Edge Density.

Architecture:

```text
main renderer
  → source/effect/mask/scene composite
  → default framebuffer
  → standalone edge shader on the SAME WebGL2 canvas
  → recording
```

The Edge runtime recomputes the mask boundary from the same geometry inputs and draws with additive blending. Circle, Blob, Portal, Custom and single-mask Trail are supported.

The previous fixed Composite glow is neutralized before the main render, so advanced edge modes are not double-added on top of the old glow. `Off` therefore removes the edge pass rather than leaving a second hidden glow implementation active.

Effect Sequence and both Motion systems preserve Edge mode/speed/density.

## Vector Trail

Vector Trail includes:

- timestamped points;
- distance resampling;
- fast-motion insertion;
- smoothing;
- velocity-derived width;
- bounded point count;
- Motion Replay reconstruction.

Release modes:

- Hold
- Dissipate
- Close
- Expand
- Burst
- Shrink

## Single-mask Motion

The original MotionRecorder remains available for the lightweight single-mask workflow.

It records:

- mask type and transform;
- Effect Stack and Effect values;
- Temporal settings;
- Edge FX settings;
- gesture state;
- velocity;
- interaction point.

Playback: Once / Loop / Reverse / Ping Pong with a scrubbable timeline.

## Project JSON

Project schema remains `version: 1`; newer fields are optional so older v0.3/v0.4/v0.5/v0.6 files can receive safe defaults.

The project file now stores:

- single-mask state;
- Custom Bezier / Feather / Expansion;
- Vector Trail release mode;
- Effect Stack;
- Temporal settings;
- Edge FX mode / speed / density;
- Carousel / transition settings;
- single-mask Motion Track;
- Multi-Mask Scene Graph;
- Scene Motion template and lanes;
- Scene Motion keyframe easing;
- Effect Sequence clips.

Imported data is bounded and sanitized. Scene Motion lane IDs must match its template Scene; Effect Sequence `maskId` values must resolve to the saved Scene/Scene Motion graph.

Uploaded image/video bytes are intentionally not embedded in JSON and must be re-selected locally after import when required.

## Recording

- `canvas.captureStream()` + `MediaRecorder`.
- Records the final WebGL canvas.
- Includes Scene compositing, Temporal FX, Effect Stack, Scene Motion, Effect Sequence and standalone Edge FX.
- Studio UI and debug overlays are excluded.

## Architecture

```text
React UI
  ├─ Studio
  ├─ EffectStackEditor
  │    └─ Edge FX controls
  ├─ ScenePanel
  │    ├─ Scene Store
  │    ├─ BezierMaskEditor
  │    ├─ SceneMotionControls
  │    │    └─ editable multi-lane timeline
  │    └─ EffectSequenceEditor
  └─ ProjectControls

Realtime engines
  ├─ HandTracker
  ├─ GestureController
  ├─ VectorTrail
  ├─ MotionRecorder
  ├─ SceneMotionRecorder
  ├─ EffectSequence
  ├─ VfxRenderer
  └─ EdgeFxRuntime
```

High-frequency tracking/render state is kept out of React where possible. React handles authored configuration and lower-frequency control state.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Camera access normally requires HTTPS or localhost.

## Validation boundary

GitHub Actions currently verifies dependency installation, TypeScript project build and Vite production bundling.

That CI **does not prove**:

- runtime GLSL compilation on every browser/GPU;
- camera permission behavior on every mobile browser;
- MediaPipe performance on real devices;
- 1/2/3/4-mask GPU frame time on target phones;
- thermal throttling behavior.

Those require actual Android/iOS/desktop browser testing. The repository does not fabricate benchmark numbers for them.

## Still intentionally not faked

Future work remains visible here instead of being exposed as placeholder controls:

- Vector Trail as a persistent Scene Graph node;
- per-Scene-node transition timelines;
- richer Effect Sequence clip timeline dragging/resizing;
- Fire / Ice and more physically complex edge families;
- WebGL GPU timer-query telemetry and pass-count profiler;
- real-device 1/2/3/4-mask benchmark reports;
- GPU-time-driven adaptive quality;
- WebGPU enhancement path;
- Web Worker / OffscreenCanvas render split.

## Next milestone — v0.9 Performance + Timeline UX

1. Add WebGL2 GPU timer-query telemetry where the browser exposes it.
2. Count real render passes per frame.
3. Build a local real-device profiler grouped by 1/2/3/4 visible masks.
4. Use GPU timing + FPS together for adaptive render scale.
5. Add direct drag/resize visualization for Effect Sequence clips.
6. Profile Android Chrome, iOS Safari and desktop Chromium before increasing the four-mask scene cap.
