import { build } from 'esbuild';
await build({
  entryPoints: ['src/mcp/stdio.ts'],
  outfile: 'build/mcp-stdio.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  tsconfig: 'tsconfig.json',
  sourcemap: false,
});
