import { build } from 'esbuild';
await build({
  entryPoints: ['src/maintenance/rotate-master-key.ts'],
  outfile: 'build/master-key-rotation.mjs',
  bundle: true,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  platform: 'node', target: 'node24', format: 'esm', tsconfig: 'tsconfig.json', sourcemap: false,
});
