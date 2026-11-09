import { build } from 'esbuild';
// Optional browser tooling; never a FleetHub runtime dependency.
const { chromium } = await import(process.env.FLEETHUB_PLAYWRIGHT_MODULE || 'playwright');
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const output = join(root, 'reports/qa/fleet-ui');
await mkdir(output, { recursive: true });
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/app/page';createRoot(document.getElementById('root')).render(<Page/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},tsconfig:join(root,'tsconfig.json')});
let css='';async function load(d){for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())await load(p);else if(e.name.endsWith('.css'))css+=await readFile(p,'utf8')}}await load(join(root,'.next/static'));
const now=new Date().toISOString();const snapshot={status:'online',timestamp:now,accounts:[],resources:[],gateways:[],worker:{status:'online',lastSeenAt:now}};
snapshot.resources.push({id:'fixture-resource',accountId:null,accountEmail:'operator@example.test',provider:'cloudflare',name:'LongResourceLabel'.repeat(14),category:'compute',state:'online',isProtected:false,tags:[],attributes:{},lastSeenAt:now,nativeId:'fixture',region:'fixture-region',sourceUrl:null,specs:{},profile:{set:false,role:'general',lifecycle:'always_on',backupClass:'none',criticality:'normal',autoStop:'off',labels:{},notes:null},inventorySource:'manual',presence:'present',freshness:'unverified'});
const [resource] = snapshot.resources;
const ownerEmail = 'operator@example.test';
const account = { id: 'acc-fixture', identityId: 'owner-fixture', kind: 'cloudflare', label: 'Fixture inventory account',
  ownerEmail, loginEmail: ownerEmail, health: 'degraded', enabled: true, isProtected: false, plan: 'free',
  credentialExpiresAt: null, collection: { state: 'stale', errorCode: 'rate_limited', message: 'Provider rate limit.',
    lastAttemptAt: now, lastSuccessAt: now, freshUntil: null, nextAttemptAt: null, resourceCount: 1 } };
resource.accountId = account.id;
snapshot.accounts.push(account);
snapshot.resources.push({ ...resource, id: 'fixture-healthy', accountId: null, name: 'Healthy unlinked resource', nativeId: 'healthy' });
const linkedAccount = { ...account, provider: account.kind, role: 'owner', createdAt: now, resources: [resource], quotaMeters: [] };
const identities = [{ id: account.identityId, displayName: 'LongIdentityLabel'.repeat(10), contacts: [],
  createdAt: now, updatedAt: now, accounts: [linkedAccount] }];
const graphNodes = [
  { id: 'owner', type: 'identity', label: identities[0].displayName, data: { contacts: [] } },
  { id: 'email', type: 'email', label: ownerEmail, parentId: 'owner', data: {} },
  { id: 'provider', type: 'provider', label: account.kind, parentId: 'email', data: {} },
  { id: 'account', type: 'account', label: account.label, parentId: 'provider', provider: account.kind, data: { accountId: account.id } },
  { id: 'resource', type: 'resource', label: resource.name, parentId: 'account', data: { resourceId: resource.id } },
];
const graph = { nodes: graphNodes, edges: graphNodes.slice(1).map(node => ({
  id: `edge-${node.id}`, source: node.parentId, target: node.id,
})), summary: { totalIdentities: 1, totalProviders: 1, totalAccounts: 1, protectedAccounts: 0, totalResources: 1, totalQuotaMeters: 0 } };
const browser=await chromium.launch({ ...(process.env.FLEETHUB_BROWSER_CHANNEL ? { channel: process.env.FLEETHUB_BROWSER_CHANNEL } : {}), headless: true });const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
let githubConnected = true;
await page.route('http://fleet.fixture/**',async route=>{const url = new URL(route.request().url());
const p = url.pathname;
const project = url.searchParams.get('project');
if(p.startsWith('/api/')){let body={};if(p==='/api/auth')body={authenticated:true,user:{email:'operator@example.test',name:'Operator',provider:'local'}};else if(p==='/api/fleet')body=project ? { ...snapshot, resources: project === 'fixture-app' ? [resource] : [] } : snapshot;else if(p==='/api/projects')body={projects:[{slug:'fixture-app',name:'Fixture project'}]};else if(p==='/api/onboarding')body={ready:true,steps:[]};else if(p==='/api/identities')body={identities,graph};else if(p==='/api/projects/footprint')body={usedBy:{},orphans:[],projects:[{
  id:'prj-fixture',slug:'fixture-app',name:'Fixture project',kind:'app',kindManual:false,placements:[],
  environment:'prod',criticality:'normal',repoUrl:null,links:[],needs:[],usage:[],keys:[],measuredUsage:[],
  usageState:'never',lastUsageAt:null,unallocatedUsage:0,billableLinks:0,
}]};else if(p==='/api/gitops/github'){
  if(route.request().method()==='DELETE')githubConnected=false;
  body={status:githubConnected?'connected':'disconnected',outcome:'revoked'};
}else if(p==='/api/rotation')body={accounts:[],rotators:[]};return route.fulfill({json:body});}
return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`});});
const checks=[];
try{for(const width of [1280,390,320]){await page.setViewportSize({width,height:844});await page.goto('http://fleet.fixture/');await page.getByRole('heading',{name:'Fleet inventory',exact:true}).waitFor();await page.waitForTimeout(400);const skip=page.getByRole('button',{name:'Skip tour',exact:true});if(await skip.count())await skip.click();if(width<768)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:/^Identities & Accounts/}).click();await page.getByRole('button',{name:'Tree View',exact:true}).waitFor();for(const view of ['Graph','Tree View','Tiers']){await page.getByRole('button',{name:view,exact:true}).click();await page.waitForTimeout(300);const size=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));checks.push({width,view,...size});if(size.documentWidth>width)console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).slice(0,15).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}))));assert.equal(size.documentWidth<=width,true,JSON.stringify(checks.at(-1)));}if(width<768)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Fleet Map',exact:true}).click();await page.getByRole('button',{name:'Table',exact:true}).click();const trigger=page.locator('tbody tr button').first();await trigger.click();const close=page.getByRole('button',{name:'Close details',exact:true});await close.waitFor();assert.equal(await close.evaluate(e=>e===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390)await page.screenshot({path:join(output,'fleet-details-mobile.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await close.count(),0);assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);checks.push({width,drawerFocus:true,escapeAndReturn:true});if(width===390)await page.screenshot({path:join(output, 'fleet-mobile.png'),fullPage:true});}
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('http://fleet.fixture/');
  const search = page.getByRole('searchbox', { name: 'Search fleet' });
  await search.waitFor();
  await page.keyboard.press('/');
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  await page.locator('body').click({ position: { x: 1270, y: 10 } });
  await page.keyboard.press('Control+k');
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  await search.fill('rate limited');
  const resourceButton = page.getByRole('button', { name: resource.name, exact: true });
  await resourceButton.click();
  const details = page.getByRole('complementary', { name: `Details for ${resource.name}` });
  await details.getByText('Provider rate limit.').waitFor();
  assert.equal(await page.getByText('Healthy unlinked resource').count(), 0);
  await page.getByRole('button', { name: 'Fleet Map', exact: true }).click();
  assert.equal(await details.count(), 1);
  assert.equal(await search.inputValue(), 'rate limited');
  assert.equal(await page.getByRole('combobox', { name: 'Filter by provider' }).count(), 1);
  await page.getByRole('button', { name: /^Identities & Accounts/ }).click();
  assert.equal(await details.count(), 1);
  await details.getByRole('button', { name: 'Close details' }).click();
  await page.getByTitle(identities[0].displayName, { exact: true }).waitFor();
  await resourceButton.focus();
  await page.keyboard.press('Enter');
  await details.getByRole('button', { name: 'Close details' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await resourceButton.evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: 'Clear fleet filters' }).click();
  await page.getByRole('checkbox', { name: 'Needs attention' }).check();
  await page.getByRole('button', { name: 'Fleet Resources', exact: false }).click();
  assert.equal(await page.getByText('Healthy unlinked resource').count(), 0);
  checks.push({ searchShortcuts: true, sharedSearch: true, retainedOwnershipPath: true, sharedDetails: true, attention: true });
  const fleetProject = page.getByRole('combobox', { name: 'Filter by project' });
  await fleetProject.selectOption('fixture-app');
  await page.waitForURL(url => url.searchParams.get('project') === 'fixture-app');
  await page.getByRole('button', { name: 'Fleet Map', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('project') === 'fixture-app' && url.searchParams.get('view') === 'map');
  await page.reload();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.locator('tbody').getByRole('button', { name: resource.name, exact: true }).waitFor();
  assert.equal(await fleetProject.inputValue(), 'fixture-app');
  assert.equal(await page.getByText('Healthy unlinked resource').count(), 0);
  await page.getByRole('button', { name: /^Identities & Accounts/ }).click();
  await page.waitForURL(url => url.searchParams.get('view') === 'identity');
  await page.goBack();
  await page.getByRole('button', { name: 'Table', exact: true }).waitFor();
  await fleetProject.selectOption('');
  await page.waitForURL(url => !url.searchParams.has('project') && url.searchParams.get('view') === 'map');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByText('Healthy unlinked resource', { exact: true }).waitFor();
  await page.goto('http://fleet.fixture/?project=unknown-project&view=map');
  await page.getByText('No resources match these filters.', { exact: true }).waitFor();
  await page.goto('http://fleet.fixture/?project=fixture-app&view=projects');
  await page.getByRole('note').getByText('Showing confirmed, active links.', { exact: false }).waitFor();
  await page.getByText('No confirmed active links.', { exact: true }).waitFor();
  const github = page.getByRole('region', { name: 'GitHub authorization' });
  await github.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await github.getByRole('status').getByText('GitHub authorization revoked.').waitFor();
  await github.getByRole('button', { name: 'Connect GitHub', exact: true }).waitFor();
  await fleetProject.selectOption('');
  await page.getByText('No linked resources yet.', { exact: true }).waitFor();
  checks.push({ projectFilter: true, viewRestored: true, historyRestored: true, scopedEmptyState: true });
  const extraResources = Array.from({ length: 200 }, (_, index) => ({
    ...resource, id: `large-${index}`, name: `Fixture resource ${index}`, nativeId: `large-${index}`,
  }));
  snapshot.resources.push(...extraResources);
  linkedAccount.resources.push(...extraResources);
  for (const item of extraResources) {
    graph.nodes.push({ id: item.id, type: 'resource', label: item.name, parentId: 'account', data: { resourceId: item.id } });
    graph.edges.push({ id: `edge-${item.id}`, source: 'account', target: item.id });
  }
  graph.summary.totalResources = linkedAccount.resources.length;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://fleet.fixture/');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Identities & Accounts/ }).click();
  const canvas = page.getByRole('region', { name: 'Identity graph. Use arrow keys to pan.' });
  await canvas.getByRole('button', { name: 'Fixture resource 199', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Fit graph to view' }).click();
  const zoomLevel = page.getByLabel('Graph zoom level');
  const zoomBeforeOut = Number(await zoomLevel.getAttribute('data-zoom'));
  await page.getByTitle('Zoom Out').click();
  const zoomAfterOut = Number(await zoomLevel.getAttribute('data-zoom'));
  assert.ok(zoomAfterOut < zoomBeforeOut, `Zoom out did not decrease fitted zoom from ${zoomBeforeOut} to ${zoomAfterOut}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('searchbox', { name: 'Search fleet' }).fill('Fixture resource 199');
  assert.equal(await canvas.getByRole('button', { name: /^Fixture resource / }).count(), 1);
  checks.push({ largeGraphResources: linkedAccount.resources.length, fitAndSearch: true, zoomOutAfterFit: true });
  assert.deepEqual(errors,[]);await writeFile(join(output, 'verification.json'),JSON.stringify({checks,errors}));console.log(JSON.stringify({checks,errors}));}finally{await browser.close()}
