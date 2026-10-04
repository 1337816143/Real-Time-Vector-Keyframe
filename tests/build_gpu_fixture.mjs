import {build} from 'esbuild';
await build({entryPoints:['tests/gpu_quad_entry.ts'],outfile:'test-results/quad-gpu-fixture.js',bundle:true,format:'iife',platform:'browser',target:'es2022'});

await build({entryPoints:['tests/face_pipeline_entry.ts'],outfile:'test-results/face-pipeline-fixture.js',bundle:true,format:'iife',platform:'browser',target:'es2022'});
