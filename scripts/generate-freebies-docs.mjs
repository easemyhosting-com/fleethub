import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Bundle the TypeScript catalog into build/ (git-ignored) so bare imports resolve, then write one Markdown file per provider.
await build({
  stdin: { contents: "export { FREEBIES } from './src/lib/catalog/freebies/index.ts'; export { renderFreebiesMarkdown } from './src/lib/catalog/freebies/markdown.ts';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: 'build/freebies-docs.mjs', tsconfig: 'tsconfig.json',
});
const { FREEBIES, renderFreebiesMarkdown } = await import(pathToFileURL(path.resolve('build/freebies-docs.mjs')).href);
const providers = new Map();
for (const entry of FREEBIES) providers.set(entry.provider, [...(providers.get(entry.provider) ?? []), entry]);
for (const [id, entries] of providers) {
  writeFileSync(`docs/freebies/${id}.md`, renderFreebiesMarkdown(entries[0].providerName, entries));
  console.log(`docs/freebies/${id}.md: ${entries.length} entries`);
}
