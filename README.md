# Real-Time Vector Keyframe

A browser-based realtime VFX studio where hand landmarks directly manipulate GPU-composited vector masks.

The product goal is not a web clone of a traditional video editor. The interaction model is:

**camera → hand tracking → gesture state machine → vector mask → GPU effect graph → temporal/motion system → recording**

## Current baseline — v0.3 Realtime VFX Studio

The repository now contains a working architectural baseline for the core product idea: **grab, move, transform and record a GPU-composited visual world with hand gestures**.

### Camera + hand interaction

- Browser camera capture with front/back camera switching.
- Mirrored front-camera mode and aspect-correct `cover` mapping.
- MediaPipe Hand Landmarker with up to two hands.
- Tracking and rendering run independently: hand inference is throttled while WebGL rendering stays on `requestAnimationFrame`.
- Explicit gesture states: `IDLE`, `HOVER`, `PINCH_START`, `GRABBED`, `DRAGGING`, `TWO_HAND_TRANSFORM`, `RELEASE`, `LOST`.
- Pinch hysteresis prevents repeated grab/release flicker.
- Tracking-loss tolerance avoids releasing the mask on a single missed frame.
- Velocity-aware drag smoothing.
- Two-hand move, scale and rotation.
- Swipe left/right switches presets.
- Lightweight hover/grab cursor rendered into the VFX canvas.

### Real GPU mask composite

The mask is not a DOM element and does not use CSS `clip-path` as the core effect.

- WebGL2 + GLSL render pipeline.
- Circle mask.
- Organic Blob mask.
- Portal mask.
- Vector Trail / Vector Slash mask.
- Mask inversion.
- Alternate image/video world behind the mask.
- Edge glow integrated with the true mask geometry.
- Velocity-reactive RGB split, distortion and mask deformation.

### True temporal VFX

The renderer owns a real camera-history texture ring instead of simulating delay with one frozen image.

- 15 historical camera textures.
- New history frame approximately every 150 ms.
- Roughly 2 seconds of usable history after warm-up.
- **Time Window** reveals a real earlier camera frame inside the mask.
- **Echo** combines current and multiple historical moments.
- **After Image** blends live and delayed frames.
- Adjustable delay from 150–2000 ms.
- Adjustable temporal mix.
- History depth shown in the debug HUD.

### Ordered Effect Stack — real multi-pass rendering

Effect order is now materially meaningful.

Render architecture:

```text
Temporal / Alternate Source
        ↓
Effect Node 1
        ↓
Ping-pong Render Target
        ↓
Effect Node 2
        ↓
Ping-pong Render Target
        ↓
...
        ↓
Final Effect Texture
        ↓
Mask Composite + Edge FX
        ↓
Final Canvas
```

Current effect nodes:

- RGB Split
- Ripple
- Pixelate
- Distortion

Each node supports:

- Enable / Disable
- Reorder Up / Down
- Intensity
- Opacity
- Blend Mode
  - Normal
  - Add
  - Screen
  - Multiply

Because each enabled node is a separate WebGL render pass, `Ripple → Pixelate` and `Pixelate → Ripple` genuinely produce different processing chains.

### Preset transitions + Carousel

Preset switching uses the GPU output rather than a CSS transition.

Before changing preset, the renderer snapshots the previous processed Effect texture and transitions between the old and new GPU results.

Supported transitions:

- Cross Fade
- Directional Wipe
- Glitch
- Flash
- Liquid

The same transition path is used by:

- Manual preset selection.
- Swipe gesture switching.
- Automatic Effect Carousel.

Carousel supports adjustable interval and transition duration. Because the transition is rendered into the final WebGL canvas, it is included in recorded video.

### Vector Trail / Vector Slash lifecycle

Vector Trail is an independent realtime engine rather than a temporary point array inside the React component.

- Timestamped input path.
- Distance-based resampling.
- Automatic intermediate points during fast hand movement.
- Path smoothing before GPU rendering.
- Predictable point cap for realtime performance.
- Velocity-derived trail width.
- Motion Replay can reconstruct Vector Slash from recorded interaction points.

Release modes:

- **Hold** — leave the spatial crack open.
- **Dissipate** — erase progressively while narrowing.
- **Close** — collapse the path toward its center.
- **Expand** — widen before disappearing.
- **Burst** — push path geometry outward.
- **Shrink** — reduce path width to zero.

### Motion Recording + automatic vector keyframes

Motion capture is separate from final video capture.

Recorded data includes:

- Mask transform.
- Mask type.
- Effect parameters.
- Effect Stack state/order.
- Temporal parameters.
- Gesture state.
- Hand velocity.
- Hand interaction point.

The recorder creates sparse keyframes based on meaningful changes rather than blindly storing every render frame.

Playback supports:

- Once
- Loop
- Reverse
- Ping Pong

Interpolation includes:

- Position.
- Scale.
- Shortest-path rotation.
- Numeric Effect parameters.
- Interaction point.

### Visual keyframe timeline

The Motion panel now includes a real timeline view.

- Displays generated keyframes at their actual times.
- Shows duration and playback head.
- Shows playback progress.
- Keyframes are clickable.
- Timeline can be dragged/scrubbed to any time.
- Scrubbing evaluates the same interpolation path as playback.
- Scrubbing a Vector Slash track reconstructs its path up to the selected time.

### Project JSON import / export

Projects can be serialized locally.

Saved project state includes:

- Current preset.
- Mask type and transform.
- Vector Trail release mode.
- Effect parameters.
- Ordered Effect Stack.
- Temporal FX.
- Carousel settings.
- GPU transition settings.
- Motion Track and keyframes.

Import performs validation and numeric bounds checks before applying state.

Uploaded image/video binary data is intentionally **not embedded** in project JSON. If a project depended on external media, the user is asked to select that media again after import.

### Final video recording

- Uses `canvas.captureStream()` + `MediaRecorder`.
- Records the final WebGL composite, not the raw camera.
- Includes mask, Effect Stack, temporal effects and GPU transitions.
- Studio UI and tracking/debug overlays are excluded from the exported video.
- Provides in-browser preview and WebM save flow.

### Debug + adaptive quality

Debug mode includes:

- 21 hand landmarks.
- Hand skeleton.
- Render FPS.
- Tracking FPS.
- Gesture state.
- Pinch ratio.
- Hand velocity.
- Mask position.
- Camera-history depth.
- Trail point count.
- Render scale.

Sustained low FPS automatically reduces internal render resolution; sustained high FPS allows gradual recovery.

## Built-in presets

- Multiverse Portal
- Cyber Reality
- Dream Window
- Time Window
- Freeze World
- Vector Slash

## Architecture

```text
React UI / project state
        ↓
Realtime Engine
        ├── Camera
        ├── HandTracker (MediaPipe ~20–30 FPS)
        │       ↓
        ├── GestureController / explicit FSM
        │       ↓
        ├── VectorTrail
        │       ├── resample + smoothing
        │       └── release lifecycle
        │
        ├── MotionRecorder
        │       ├── sparse keyframe generation
        │       ├── arbitrary-time sampling
        │       └── interpolated playback
        │
        └── VfxRenderer (WebGL2 / GLSL)
                ├── camera texture
                ├── alternate media texture
                ├── camera-history ring
                ├── temporal source pass
                ├── ordered Effect Stack
                │       └── ping-pong render targets
                ├── GPU preset transition snapshot
                ├── vector mask composite
                ├── edge / hover FX
                └── final recordable canvas
```

React is intentionally not used as the per-frame motion transport. High-frequency gesture, mask, trail, temporal and renderer state lives in realtime engine objects; React manages controls and low-frequency UI state.

## Main source files

```text
src/
├── App.tsx
├── components/
│   ├── Studio.tsx
│   ├── EffectStackEditor.tsx
│   ├── MotionTimeline.tsx
│   └── ProjectControls.tsx
└── engine/
    ├── handTracking.ts
    ├── gesture.ts
    ├── motion.ts
    ├── project.ts
    ├── trail.ts
    ├── renderer.ts
    └── types.ts
```

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Camera access requires a secure context (`https://` or localhost) in normal browser deployment.

## What is intentionally not faked yet

The following major features from the full product specification are still future work and are not represented by placeholder controls:

- Editable Bezier anchor/control handles.
- Freehand path → editable Bezier conversion UI.
- Multi-mask scene graph with independent Effect Stacks.
- Authored Sequence editor with per-effect time ranges.
- Advanced Edge FX families such as electric arcs, fire, ice, particles and scanner.
- WebGPU enhancement path.
- Web Worker / OffscreenCanvas renderer split.
- Full real-device performance validation matrix across Android Chrome, iOS Safari and desktop Chromium.

## Next milestone — v0.4 Vector Mask Editor + Multi-Mask foundation

Recommended order:

1. Introduce a normalized vector-path data model with anchors and Bezier handles.
2. Convert freehand / trail geometry into editable curve segments.
3. Add `Move Entire Mask` and `Edit Vertices` modes.
4. Add Feather / Expansion controls to vector masks.
5. Introduce a multi-mask scene graph with independent transform and Effect Stack state.
6. Preserve backward compatibility with the current single-mask project JSON.
7. Add real-device gesture/render profiling before increasing shader complexity further.
