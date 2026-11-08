import fs from 'node:fs/promises';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const cutoff = Date.now() - 48 * 60 * 60 * 1000;
const selected = [];
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, current] of Object.entries(pkg[section])) {
    const response = await fetch(`https://registry.npmjs.org/${name}`);
    if (!response.ok) throw new Error(`Registry failed for ${name}`);
    const metadata = await response.json();
    const major = current.replace(/^[^\d]*/, '').split('.')[0];
    const versions = Object.keys(metadata.versions).filter(version => /^\d+\.\d+\.\d+$/.test(version) && version.split('.')[0] === major && Date.parse(metadata.time[version]) <= cutoff && !metadata.versions[version].deprecated);
    versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const version = versions.at(-1);
    if (!version) throw new Error(`No mature release for ${name}`);
    pkg[section][name] = version;
    selected.push({ name, version, published: metadata.time[version] });
  }
}
for (const name of ['@types/node', '@types/react', 'typescript']) {
  if (Object.hasOwn(pkg.dependencies, name)) {
    pkg.devDependencies[name] = pkg.dependencies[name];
    delete pkg.dependencies[name];
  }
}
pkg.private = true;
delete pkg.main;
delete pkg.directories;
pkg.engines = { node: '24.22.1' };
pkg.scripts.typecheck = 'tsc --noEmit';
pkg.scripts['check:dependencies'] = 'node scripts/check-dependencies.mjs';
pkg.scripts['check:hygiene'] = 'node scripts/check-hygiene.mjs';
pkg.overrides = { '@esbuild-kit/core-utils': { esbuild: '0.28.2' } };
await fs.writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
await fs.writeFile('docs/dependency-versions.json', JSON.stringify({ checkedAt: new Date().toISOString(), minimumAgeHours: 48, packages: selected }, null, 2) + '\n');
console.log(selected);
