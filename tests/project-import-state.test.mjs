import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
let instance = 0;

async function harness() {
  const modules = ['project', 'sceneMotion', 'sceneStore', 'bezierStore', 'effectSequence', 'scene', 'types', 'motion'];
  const result = await build({
    stdin: {
      contents: modules.map((name) => `export * from './src/engine/${name}';`).join('\n'),
      resolveDir: root,
      sourcefile: 'project-import-state-entry.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
  });
  // One module graph shares the production stores and recorder with the parser.
  // A unique module URL gives each test fresh state, without replacing any module.
  const source = `${result.outputFiles[0].text}\n// test instance ${instance++}`;
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const scene = api.createDefaultScene();
  scene.nodes[0].id = 'test-mask';
  scene.nodes[0].effects.faceFx = 'none';
  scene.selectedMaskId = 'test-mask';
  api.replaceScene(scene, true);
  api.setBezierMaskState({ enabled: true, feather: 0.04, expansion: 0.2 });
  api.addEffectSequenceClip('test-mask', 1000);
  const before = {
    scene: structuredClone(api.getSceneState()),
    bezier: structuredClone(api.getBezierMaskState()),
    effects: api.getEffectSequenceTrack(),
  };
  const events = [];
  api.subscribeScene(() => events.push('scene'));
  api.subscribeBezierMask(() => events.push('bezier'));
  api.subscribeEffectSequence(() => events.push('effects'));
  return { api, scene, before, events };
}

function project({ api }) {
  return api.createProjectSnapshot({
    preset: 'cyber',
    mask: {
      type: 'crossHandQuad',
      transform: { x: 0.5, y: 0.5, scale: 0.22, rotation: 0 },
      trailReleaseMode: 'hold',
    },
    effects: { ...api.PRESETS.cyber.effects, faceFx: 'none' },
    carousel: { enabled: false, intervalMs: 3000, transitionType: 'crossFade', transitionDurationMs: 650 },
  });
}

function assertStoresUnchanged({ api, before, events }) {
  assert.deepEqual(api.getSceneState(), before.scene);
  assert.deepEqual(api.getBezierMaskState(), before.bezier);
  assert.deepEqual(api.getEffectSequenceTrack(), before.effects);
  assert.deepEqual(events, [], 'Rejected imports must not notify store subscribers');
}

for (const field of ['transform', 'effects', 'motion']) {
  test(`project import: rejected ${field} preserves buffered recording and stores`, async () => {
    const h = await harness();
    const recorder = h.api.sceneMotionRecorder;
    recorder.start(h.scene, 1000);
    h.scene.nodes[0].transform.x = 0.6;
    recorder.capture(h.scene, 1200);
    const input = project(h);
    if (field === 'transform') delete input.mask.transform;
    else if (field === 'effects') input.effects = null;
    else input.motion = 'invalid';

    assert.throws(() => h.api.parseProject(JSON.stringify(input)), /Expected an object/);
    assert.equal(recorder.isRecording(), true);
    h.scene.nodes[0].transform.x = 0.7;
    recorder.capture(h.scene, 1400);
    const track = recorder.stop(h.scene, 1600);
    assert.deepEqual(track.lanes[0].keyframes.map((frame) => frame.t), [0, 200, 400, 600]);
    assert.deepEqual(track.lanes[0].keyframes.map((frame) => frame.node.transform.x), [0.5, 0.6, 0.7, 0.7]);
    assertStoresUnchanged(h);
  });
}

test('project import: rejected import retains reverse playback and its selected range', async () => {
  const h = await harness();
  const recorder = h.api.sceneMotionRecorder;
  recorder.start(h.scene, 1000);
  h.scene.nodes[0].transform.x = 0.8;
  recorder.capture(h.scene, 2000);
  recorder.stop(h.scene, 2000);
  recorder.setPlaybackRange(100, 800);
  recorder.play('reverse', 5000);
  const savedTrack = recorder.getTrack();
  const input = project(h);
  input.effects = null;

  assert.throws(() => h.api.parseProject(JSON.stringify(input)), /Expected an object/);
  assert.equal(recorder.isPlaying(), true);
  assert.deepEqual(recorder.getTrack(), savedTrack);
  assert.deepEqual(recorder.getPlaybackRange(), { inMs: 100, outMs: 800 });
  assert.equal(recorder.getCurrentTime(5200), 600);
  assertStoresUnchanged(h);
});

test('project import: valid populated project still replaces state and notifies subscribers', async () => {
  const source = await harness();
  const sceneRecorder = source.api.sceneMotionRecorder;
  sceneRecorder.start(source.scene, 1000);
  source.scene.nodes[0].transform.x = 0.8;
  sceneRecorder.capture(source.scene, 2000);
  sceneRecorder.stop(source.scene, 2000);
  const input = project(source);
  input.mask.customFeather = 0.03;
  const quad = {
    points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }],
    opacity: 1, status: 'tracking', timestamp: 1000,
  };
  const motion = new source.api.MotionRecorder();
  const state = {
    maskType: 'crossHandQuad', quad, transform: input.mask.transform, effects: input.effects,
    gestureState: 'IDLE', handSpeed: 0, trail: [], time: 1000,
  };
  motion.start(1000);
  motion.capture(state, 1000);
  motion.capture({ ...state, time: 2000 }, 2000);
  motion.stop(2000);
  input.motion = motion.getTrack();

  const h = await harness();
  h.api.sceneMotionRecorder.start(h.scene, 10);
  const parsed = h.api.parseProject(JSON.stringify(input));
  assert.equal(h.api.sceneMotionRecorder.isRecording(), false);
  assert.equal(h.api.sceneMotionRecorder.isPlaying(), false);
  assert.deepEqual(h.api.getSceneState(), { enabled: input.scene.enabled, scene: input.scene.graph });
  assert.deepEqual(h.api.getBezierMaskState(), {
    enabled: false, curve: input.mask.customCurve, feather: 0.03, expansion: input.mask.customExpansion,
  });
  assert.deepEqual(h.api.getEffectSequenceTrack(), input.effectSequence);
  assert.deepEqual(h.api.sceneMotionRecorder.getTrack(), input.sceneMotion);
  assert.deepEqual(h.api.sceneMotionRecorder.getPlaybackRange(), { inMs: 0, outMs: 1000 });
  assert.deepEqual(h.events, ['bezier', 'scene', 'effects']);
  assert.equal(parsed.preset, input.preset);
  assert.deepEqual(parsed.effects, input.effects);
  assert.deepEqual(parsed.motion, input.motion);
  assert.deepEqual(parsed.motion.keyframes[0].quad.points, quad.points);
});
