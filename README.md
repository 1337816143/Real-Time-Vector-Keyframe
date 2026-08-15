# Real-Time Vector Keyframe

Browser-based realtime VFX Studio where hand landmarks manipulate GPU-composited vector masks.

```text
Camera
  → MediaPipe Hand Tracking
  → Gesture FSM
  → Vector / Bezier / Multi-Mask Scene
  → Temporal + Ordered Effect Stack
  → Scene Motion / Effect Sequence
  → Standalone Edge FX Pass
  → GPU telemetry + adaptive quality
  → final WebGL canvas
  → MediaRecorder
```

## Current baseline — v0.9

The current `main` contains a real realtime/rendering chain rather than placeholder controls:

- WebGL2 camera compositing and procedural/custom masks;
- MediaPipe hand tracking + explicit gesture state machine;
- Custom Bezier authoring and Freehand → editable curve conversion;
- Temporal history effects;
- ordered multi-pass Effect Stack;
- up to four independent Scene masks;
- identity-preserving Scene Motion lanes;
- editable keyframes, easing, retiming and In / Out playback;
- authored Effect Sequence clips with direct timeline drag/resize;
- standalone Neon / Scanner / Electric / Particle GPU edge pass;
- WebGL2 timer-query telemetry when supported;
- calculated render-pass count;
- local 1/2/3/4-mask profiler + JSON export;
- GPU + FPS aware adaptive Render Scale;
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
- Scene Motion playback suspends live hand transforms so playback and gesture input do not fight over the same node.

## GPU masks

Masks are rendered in WebGL2 / GLSL rather than CSS `clip-path`.

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

Vector Trail remains a single-mask realtime/motion geometry and is not yet a persistent Scene Graph node.

## Custom Bezier + Freehand

The SVG editor is an authoring layer only. Its curve data is sampled and sent into the recordable WebGL mask pipeline.

Supported editing:

- Cubic Bezier anchors;
- incoming/outgoing handles;
- linked or free tangents;
- anchor/handle dragging;
- de Casteljau insertion;
- closed curves with at least three anchors;
- local geometry coordinates separate from global hand transform.

Freehand mode converts a rough silhouette into a compact editable curve:

1. capture local stroke samples;
2. remove near-duplicates;
3. resample by arc length;
4. reduce to a small anchor set;
5. estimate smooth handles;
6. continue editing as Cubic Bezier geometry.

Custom masks use an SDF-like polygon approximation in GLSL. `Expansion` offsets the signed-distance boundary and `Feather` changes the actual boundary blend band; neither is implemented as CSS scale/blur.

## Multi-Mask Scene

Scene mode currently caps the graph at four masks so GPU cost stays bounded while real-device profiling is accumulated.

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

Structural edits are blocked while Scene Motion is recording or playing so lane identity cannot be invalidated mid-animation.

### Scene GPU composition

For each visible mask, the renderer runs its own source/effect/mask stages and accumulates the scene through render targets:

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

Temporal delay and mix are per Effect settings. Scene nodes share the camera-history pool but keep independent Temporal configuration.

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

Changing the node order changes the actual texture entering the next pass.

## Editable Scene Motion

Scene Motion is separate from the original single-mask MotionRecorder so older lightweight workflows remain valid.

Each Scene mask owns one lane keyed by stable `maskId`.

Recorded/keyframeable state includes:

- position / scale / rotation;
- visibility / lock;
- Effect values and Effect Stack state;
- Temporal settings;
- Edge FX mode / speed / density;
- geometry kind;
- Custom Bezier anchors and handles;
- Custom Feather / Expansion.

### Sparse capture + interpolation

Scene Motion emits keys when a node changes meaningfully, plus periodic timing keys.

Interpolation includes:

- numeric transform interpolation;
- shortest-path angular rotation;
- numeric Effect / Temporal / Edge interpolation;
- compatible Effect Stack intensity/opacity interpolation;
- Custom Bezier anchor/handle interpolation when topology matches;
- safe nearest-side switching when Bezier topology differs.

### Keyframe editing

The multi-lane timeline supports:

- select a key;
- drag an interior key horizontally to retime it;
- retime through the Inspector slider;
- update a selected key from the current Scene;
- delete interior keys;
- fixed first/last boundary keys;
- per-segment easing:
  - Linear
  - Ease In
  - Ease Out
  - Ease In-Out
- Scrub through the same evaluator used by playback.

### Playback range

Explicit In / Out limits are respected by:

- Once
- Loop
- Reverse
- Ping Pong

The timeline shades content outside the active playback range.

## Effect Sequence

Effect Sequence adds authored, time-ranged VFX clips on top of Scene Motion.

Each clip owns:

- stable clip ID;
- target `maskId`;
- Start / End;
- enabled state;
- preset;
- intensity;
- Fade In / Fade Out;
- overlay order.

The editor supports both numeric precision controls and direct timeline editing:

- add a clip at the playhead;
- drag the clip body to move the whole interval;
- drag the left/right handles to resize Start/End;
- choose target Mask and Preset;
- edit Fade In / Fade Out;
- edit intensity;
- reorder, disable or delete clips.

Sequence evaluation is non-destructive. It creates render-only effective Effect/Temporal/Edge settings and does **not** rewrite Transform, geometry or stored Scene Motion keys.

Scene Motion Scrub and Effect Sequence share the same preview clock.

## Standalone Edge FX GPU pass

Advanced edge rendering is separate from the ordered texture Effect Stack.

Modes:

- Off
- Neon
- Scanner
- Electric
- Particle

Controls:

- Glow = edge intensity;
- Edge Speed;
- Edge Density.

Architecture:

```text
main renderer
  → source / effect / mask / scene composite
  → default framebuffer
  → standalone edge shader on the SAME WebGL2 canvas
  → GPU profiler wrapper
  → recording
```

The Edge runtime recomputes the mask boundary from the current geometry and uses additive blending. Circle, Blob, Portal, Custom and single-mask Trail are supported.

The old fixed Composite glow is neutralized before main rendering. Edge mode `Off` therefore really removes the edge pass instead of leaving a second hidden glow implementation active.

Both Motion systems, Effect Sequence and Project JSON preserve Edge mode/speed/density.

## v0.9 GPU telemetry

`gpuProfiler.ts` wraps the complete render call outside the Edge runtime, so the timing region covers the main renderer plus final Edge pass.

When the browser exposes `EXT_disjoint_timer_query_webgl2`:

- a timer query is sampled periodically rather than every frame;
- query results are read asynchronously;
- disjoint intervals are detected;
- invalid/disjoint GPU samples are discarded;
- GPU nanoseconds are converted to milliseconds.

When the extension is unavailable, GPU time is displayed as `N/A` / `unsupported`; the app does not estimate a fake GPU time from JavaScript frame time.

### Render-pass telemetry

The profiler also reports the current render-pass count from the active graph:

Single mask:

```text
Source + enabled Effect nodes + Composite + optional Edge pass
```

Scene:

```text
Σ(each visible mask: Source + enabled Effect nodes + Composite + optional Edge pass)
```

Camera texture uploads/history capture are not mislabeled as render passes.

## Real-device Performance Profiler

A collapsed `GPU PROFILER` control appears once the Studio starts rendering.

Live telemetry:

- Render FPS
- GPU ms, when supported
- Pass count
- visible Mask count
- Render Scale
- timer disjoint warning

Sampling is intentionally low-frequency (about four accepted samples per second) to avoid turning the profiler UI into a significant workload itself.

Samples are bucketed independently for 1 / 2 / 3 / 4 visible masks. Each bucket reports/stores:

- sample count;
- FPS P50;
- FPS P05;
- GPU P50, when available;
- GPU P95, when available;
- Pass P50;
- average Render Scale.

The profiler can reset its local samples and export a JSON report containing:

- bucket statistics;
- latest telemetry;
- browser user agent;
- logical CPU count when exposed;
- `deviceMemory` when exposed;
- screen size and DPR.

No benchmark score is invented before a device actually runs the workload.

## GPU + FPS adaptive quality

The original Studio still has its conservative FPS-based scale reduction/recovery behavior. v0.9 adds an outer quality controller that also uses GPU telemetry and enforces a Render Scale ceiling.

Evaluation cadence is roughly once per second.

Current pressure thresholds:

- GPU pressure: `> 18.5 ms` when timer data is valid;
- severe GPU pressure: `> 27 ms`;
- FPS pressure: `< 43 FPS`.

Sustained pressure lowers the quality ceiling. Severe GPU pressure drops it more aggressively. Recovery requires:

- FPS at or above roughly 57; and
- GPU below roughly 12.5 ms when timer data exists;
- several consecutive recovery evaluations.

Because `setRenderScale()` is capped by this controller, the older FPS recovery path cannot immediately raise resolution above a GPU-imposed ceiling.

On browsers without GPU timer-query support, the adaptive controller falls back to FPS rather than guessing GPU time.

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

The original MotionRecorder remains available and records:

- mask type and transform;
- Effect Stack and Effect values;
- Temporal settings;
- Edge FX settings;
- gesture state;
- velocity;
- interaction point.

Playback: Once / Loop / Reverse / Ping Pong with a scrubbable timeline.

## Project JSON

Project schema remains `version: 1`; newer fields are optional so older files receive safe defaults.

The project stores:

- single-mask state;
- Custom Bezier / Feather / Expansion;
- Vector Trail release mode;
- Effect Stack;
- Temporal settings;
- Edge FX settings;
- Carousel / transition settings;
- single-mask Motion Track;
- Multi-Mask Scene Graph;
- Scene Motion template and lanes;
- Scene Motion easing;
- Effect Sequence clips.

Imported data is bounded and sanitized. Scene Motion lane IDs must match the stored template Scene, and Effect Sequence target IDs must resolve to the saved Scene/Scene Motion graph.

Uploaded image/video binary data is intentionally not embedded in project JSON.

## Recording

- `canvas.captureStream()` + `MediaRecorder`.
- Records the final WebGL canvas.
- Includes Scene compositing, Temporal FX, Effect Stack, Scene Motion, Effect Sequence and standalone Edge FX.
- Studio/debug/profiler UI is not painted into the canvas.

## Architecture

```text
React UI
  ├─ Studio
  ├─ EffectStackEditor
  │    └─ Edge FX controls
  ├─ ScenePanel
  │    ├─ BezierMaskEditor
  │    ├─ SceneMotionControls
  │    │    └─ editable multi-lane timeline
  │    └─ EffectSequenceEditor
  │         └─ draggable clip timeline
  ├─ PerformanceProfiler
  └─ ProjectControls

Realtime engines
  ├─ HandTracker
  ├─ GestureController
  ├─ VectorTrail
  ├─ MotionRecorder
  ├─ SceneMotionRecorder
  ├─ EffectSequence
  ├─ VfxRenderer
  ├─ EdgeFxRuntime
  ├─ GpuProfilerRuntime
  └─ AdaptiveQualityRuntime
```

High-frequency tracking/render state stays outside React where possible. The profiler accepts low-frequency samples and only updates its UI periodically.

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

GitHub Actions verifies dependency installation, the TypeScript project build and the Vite production bundle.

CI can verify that the v0.9 TypeScript/runtime wrappers and UI compile together, but CI **cannot prove**:

- runtime GLSL compilation on every browser/GPU;
- that a specific device exposes `EXT_disjoint_timer_query_webgl2`;
- camera permission behavior on every mobile browser;
- MediaPipe throughput on real phones;
- thermal throttling;
- actual 1/2/3/4-mask GPU timings.

Those values must come from the new on-device Profiler. Reports should be collected on Android Chrome, iOS Safari and desktop Chromium before the four-mask cap or quality thresholds are increased.

## Still intentionally not faked

Future work remains future work rather than placeholder UI:

- Vector Trail as a persistent Scene Graph node;
- independent per-Scene-node transition timelines;
- Fire / Ice and more physically complex edge families;
- automated device-profile quality presets derived from collected reports;
- WebGPU enhancement path;
- Web Worker / OffscreenCanvas render split;
- formal real-device test matrix and stored benchmark report set.

## Next milestone — v0.10 Device Validation + Scene Completeness

1. Collect real profiler reports on Android Chrome, iOS Safari and desktop Chromium.
2. Tune adaptive thresholds only from measured reports rather than assumptions.
3. Add a persistent Vector Trail Scene node without breaking `maskId` motion lanes.
4. Add independent per-node transition ownership/timelines.
5. Evaluate Fire / Ice edge families against measured GPU budget.
6. Split expensive tracking/render work into Worker/OffscreenCanvas paths where browser support makes it worthwhile.
