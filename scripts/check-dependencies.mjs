import fs from 'node:fs/promises';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${name} must use an exact stable version`);
  if (lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`${name} lockfile mismatch`);
  const response = await fetch(`https://registry.npmjs.org/${name}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Registry unavailable for ${name}`);
  const metadata = await response.json();
  const published = Date.parse(metadata.time?.[version]);
  if (!Number.isFinite(published) || Date.now() - published < 48 * 3600000) throw new Error(`${name}@${version} is less than 48 hours old`);
  if (metadata.versions[version].deprecated) throw new Error(`${name}@${version} is deprecated`);
}
console.log('Direct dependencies are pinned, locked, and at least 48 hours old.');
