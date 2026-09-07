# Evolution website sync contract

The user has explicitly required this project to remain a long-term module in the personal Evolution website.

## Website maintenance target

- Project source: `1337816143/Real-Time-Vector-Keyframe`
- Website source of truth: `1337816143/My-Evolution`
- Public website mirror: `1337816143/Evolution`
- Public project module: `pages/real-time-vector-keyframe.html`
- Website project facts: `site/data/real-time-vector-keyframe-project.json`
- Website sync contract: `07-projects-products/real-time-vector-keyframe/SYNC.md`

Never directly maintain the public `Evolution` mirror. Update `My-Evolution` and let its standard build/publish workflow produce the public site.

## When this project changes

For any material user-visible change, update the Evolution module in the same work session whenever tools and repository access allow it. Material changes include:

- camera / MediaPipe / WebGL runtime fixes or regressions;
- new or removed masks, effects, Scene, Motion, transitions, recording or export behavior;
- deployment URL, Pages state, stable release/rollback changes;
- device/browser compatibility findings;
- roadmap items moving between planned and implemented;
- important architecture or performance changes.

The website record must include the actual source commit being described. Read the real `main` state before updating the website; do not promote features that exist only in chat or plans.

## Accuracy rules

- Build success, GitHub Pages deployment success and successful realtime camera/VFX behavior on a specific device are separate facts.
- Fire / Ice Edge FX remain planned until merged into source.
- Current per-mask effect-parameter interpolation is not the same as full texture-snapshot spatial transitions.
- Camera Recovery Runtime is a fallback mechanism, not proof that every browser/device has been validated.

This file is a persistent handoff note for future maintainers and AI coding sessions.
