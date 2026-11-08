import { build } from 'esbuild';
// Playwright is an optional verification tool, not a FleetHub runtime dependency.
const { chromium } = await import(process.env.FLEETHUB_PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const out = resolve('reports/qa/reuse-first');
await mkdir(out, {recursive:true});
const bundled = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SetupWizard} from './src/components/SetupWizard'; createRoot(document.getElementById('root')).render(<SetupWizard onClose={()=>{document.getElementById('root').textContent='Setup closed'}} onConnectProvider={()=>{document.getElementById('root').textContent='Provider opened'}} />);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const script = bundled.outputFiles[0].text;
let css = '';
async function loadCss(dir) { for (const entry of await readdir(dir,{withFileTypes:true})) { const p=join(dir,entry.name); if(entry.isDirectory()) await loadCss(p); else if(entry.name.endsWith('.css')) css += await readFile(p,'utf8'); } }
await loadCss('.next/static');
assert.ok(css.length > 0, 'Run npm run build before verifying the styled setup UI.');
let state;
let posts=[];
let rejectVerify=false;
const fixture = () => ({ready:false,steps:['tailscale','infisical','cliproxy','builtin'].map(id=>({id,status:'unconfigured',config:{},verifiedAt:null,message:'Configure and verify this connection'}))});
const browser = await chromium.launch({ ...(process.env.FLEETHUB_BROWSER_CHANNEL ? {channel:process.env.FLEETHUB_BROWSER_CHANNEL} : {}), headless:true });
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('http://setup.fixture/**',async route=>{
 const request=route.request();
 if(new URL(request.url()).pathname==='/api/onboarding') {
   if(request.method()==='POST'){
     const body=request.postDataJSON();posts.push(body);
     if(body.action==='verify'&&rejectVerify) return route.fulfill({status:401,json:{error:'Service rejected the request; check its URL, credentials, and scoped permissions'}});
     const step=state.steps.find(s=>s.id===body.step);
     if(body.action==='save'){step.config=body.config;step.status='configured';}
     else if(body.action==='skip'){step.skipped=true;}
     else {step.status='verified';step.verifiedAt=new Date().toISOString();step.skipped=false;}
     state.ready=state.steps.some(s=>['builtin','infisical'].includes(s.id)&&s.status==='verified');
   }
   return route.fulfill({json:state});
 }
 await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script>${script.replaceAll('</script','<\\/script')}</script></body></html>`});
});
const checks=[];
async function fresh(next=fixture()){state=next;posts=[];rejectVerify=false;await page.goto('http://setup.fixture/');await page.getByRole('heading',{name:'Infisical vault',exact:true}).waitFor();}
try {
 await fresh();
 assert.equal(await page.getByRole('button',{name:'Connect existing',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.getByLabel('API URL (reachable from FleetHub)',{exact:true}).inputValue(),'');
 assert.equal(await page.getByText('Start only Infisical on your host',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Set up locally',exact:true}).click();
 assert.match(await page.locator('pre').innerText(),/--profile infisical up -d infisical/);
 assert.doesNotMatch(await page.locator('pre').innerText(),/--profile integrations|cli-proxy-api/);
 assert.equal(posts.length,0);checks.push('New install defaults to connect existing; revealing local commands makes no write request.');
 await page.getByRole('button',{name:'CLIProxyAPI gateway',exact:false}).click();
 assert.equal(await page.getByRole('button',{name:'Connect existing',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Set up locally',exact:true}).click();
 assert.match(await page.locator('pre').innerText(),/--profile cliproxy up -d --build cli-proxy-api/);
 assert.doesNotMatch(await page.locator('pre').innerText(),/--profile infisical|--profile integrations/);
 await page.getByRole('button',{name:'Use local Compose addresses',exact:true}).click();
 assert.equal(await page.getByLabel('API URL (reachable from FleetHub)',{exact:true}).inputValue(),'http://cli-proxy-api:8317');
 assert.equal(await page.getByRole('button',{name:'Infisical vault',exact:false}).isDisabled(),true);
 await page.getByRole('button',{name:'Discard changes',exact:true}).click();
 assert.equal(await page.getByLabel('API URL (reachable from FleetHub)',{exact:true}).inputValue(),'');
 assert.equal(posts.length,0);
 assert.equal(await page.getByRole('button',{name:'Infisical vault',exact:false}).isDisabled(),false);
 await page.getByRole('button',{name:'Use local Compose addresses',exact:true}).click();
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await page.getByText('Settings saved. Verify the connection to continue.',{exact:true}).waitFor();
 assert.equal(posts.length,1);assert.equal(posts[0].step,'cliproxy');assert.equal(state.ready,false);
 rejectVerify=true;
 await page.getByRole('button',{name:'Verify connection',exact:true}).click();
 await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button',{name:'Set up locally',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(posts.length,2);checks.push('Switching services resets install mode; only selected-service command is shown; dirty drafts require explicit save/discard; discard restores saved values without writes; failed verification never starts services.');
 await fresh();
 await page.getByRole('button',{name:'Tailscale mesh',exact:false}).click();
 assert.equal(await page.getByRole('group',{name:'Setup mode'}).count(),0);
 assert.doesNotMatch(await page.getByRole('main').innerText(),/docker compose|--profile/);
 await page.getByRole('button',{name:'Skip for now',exact:true}).click();
 await page.getByRole('heading',{name:'CLIProxyAPI gateway',exact:true}).waitFor();
 assert.equal(posts.length,1);assert.deepEqual(posts[0],{action:'skip',step:'tailscale'});assert.equal(state.steps.find(s=>s.id==='tailscale').skipped,true);
 await page.getByRole('button',{name:'Skip for now',exact:true}).click();
 await page.getByText('Setup closed',{exact:true}).waitFor();assert.equal(posts.length,2);assert.equal(state.ready,false);checks.push('Optional skips persist without granting readiness; Tailscale offers no integration-container command.');
 await fresh(state);
 await page.getByRole('button',{name:'CLIProxyAPI gateway',exact:false}).click();
 await page.getByText('Skipped for now. Any saved connection remains unchanged. Save or verify to resume setup.',{exact:true}).waitFor();
 const verified=fixture();verified.ready=true;const backend=verified.steps.find(s=>s.id==='builtin');backend.status='verified';backend.verifiedAt=new Date().toISOString();
 state=verified;posts=[];await page.goto('http://setup.fixture/');
 await page.getByRole('heading',{name:'Built-in secret store',exact:true}).waitFor();
 assert.equal(await page.getByRole('group',{name:'Setup mode'}).count(),0);
 await page.getByRole('button',{name:'Connect provider',exact:true}).click();
 await page.getByText('Provider opened',{exact:true}).waitFor();assert.equal(posts.length,0);checks.push('A verified built-in backend reopens directly and permits provider connection with optional services absent.');
 const existing=fixture();existing.ready=true;const v=existing.steps.find(s=>s.id==='infisical');v.status='verified';v.config={apiUrl:'https://vault.example.test',consoleUrl:'https://vault.example.test',projectId:'project-test',environment:'prod',secretPath:'/existing'};v.verifiedAt=new Date().toISOString();
 await fresh(existing);assert.equal(await page.getByLabel('Secret path',{exact:true}).inputValue(),'/existing');
 assert.equal(await page.getByLabel('API URL (reachable from FleetHub)',{exact:true}).inputValue(),'https://vault.example.test');checks.push('Existing verified backend URLs and paths are preserved.');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:join(out,'setup-mobile-existing.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 await page.getByRole('button',{name:'Set up locally',exact:true}).click();
 await page.screenshot({path:join(out,'setup-mobile-local.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 checks.push('Existing and local-install panels fit a 390px viewport without document overflow.');
 assert.deepEqual(errors,[]);
 await writeFile(join(out,'results.json'),JSON.stringify({checks,cssLoaded:css.length>0,pageErrors:errors},null,2));
 console.log(JSON.stringify({checks,cssLoaded:css.length>0,pageErrors:errors},null,2));
} finally {await browser.close();}
