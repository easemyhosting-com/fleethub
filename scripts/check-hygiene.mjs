import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const allowed = new Set(['.gitignore', '.dockerignore', '.nvmrc', 'Dockerfile', 'compose.yml', 'package.json', 'package-lock.json', 'drizzle.config.ts', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'vitest.config.ts', 'README.md', 'AGENTS.md', 'SECURITY.md', 'LICENSE']);
for (const file of files) {
  if (!file.includes('/') && !allowed.has(file)) throw new Error(`Unexpected root file: ${file}`);
  if (/(^|\/)(node_modules|coverage|\.next|user_inputs|\.playwright-cli|reports|test-results)(\/|$)|(^|\/)\.env|\.(pem|key|tsbuildinfo)$/.test(file)) throw new Error(`Generated or sensitive file exposed to Git: ${file}`);
}
console.log('Repository hygiene checks passed.');
