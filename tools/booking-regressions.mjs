// Reuse the reviewed prior tests against the additive booking chain, preserving
// original test sources/evidence. The four added private tables make 24 total.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const project=fileURLToPath(new URL('../',import.meta.url));const cache=join(project,'.cache');await mkdir(cache,{recursive:true});
const runtime=process.env.PLANZO_TEST_RUNTIME||join(cache,'booking-runtime/node_modules');
const run=promisify(execFile);
for(const [name,evidence] of [['planning-check','BOOKING_PLANNING_REGRESSIONS'],['backend-check','BOOKING_IDENTITY_REGRESSIONS'],['itinerary-check','BOOKING_ITINERARY_REGRESSIONS']]){
 if(process.argv.length>2&&!process.argv.slice(2).includes(name))continue;
 let source=await readFile(new URL('./'+name+'.mjs',import.meta.url),'utf8');
 const old="await db.query(await readFile(new URL('../supabase/changes/planzo_itinerary.sql',import.meta.url),'utf8'));";
 if(!source.includes(old))throw Error('Regression harness baseline changed: '+name);
 source=source.replace(old,old+"await db.query(await readFile(new URL('../supabase/changes/planzo_booking.sql',import.meta.url),'utf8'));");
 source=source.replace("import { pathToFileURL } from 'node:url';","import { pathToFileURL,fileURLToPath } from 'node:url';");
 source=source.replaceAll('join(tmpdir(),',"join(fileURLToPath(new URL('./',import.meta.url)),");
 source=source.replace('persistent:false,onLog',"persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog");
 source=source.replaceAll('stats.total,20','stats.total,24').replaceAll('stats.protected,20','stats.protected,24').replaceAll('Number(stats.total),20','Number(stats.total),24').replaceAll('tables.n,20','tables.n,24').replaceAll('tables.protected,20','tables.protected,24').replaceAll('All 20','All 24');
 source=source.replace(/\.\.\/docs\/backend\/(PLANNING_DATABASE_TESTS|LOCAL_DATABASE_TESTS|ITINERARY_DATABASE_TESTS)\.json/g,'../docs/backend/'+evidence+'.json');
 const path=join(cache,name+'.mjs');await writeFile(path,source);
 const result=await run(process.execPath,[path],{cwd:project,env:{...process.env,PLANZO_TEST_RUNTIME:runtime},maxBuffer:1024*1024,windowsHide:true});
 const record=JSON.parse(await readFile(join(project,'docs/backend/'+evidence+'.json'),'utf8'));
 console.log(name+': '+(record.tests||record.checks||[]).length+' passed. '+result.stdout.trim().split('\n').at(-1));
}
