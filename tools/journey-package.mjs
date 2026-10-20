import {readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=b=>createHash('sha256').update(b).digest('hex');
for(const name of ['SOURCE_HASHES','SUPABASE_SOURCE_HASHES']){const path='docs/backend/PRE_JOURNEY_'+name+'.json';try{await access(path);}catch{await copyFile('docs/backend/'+name+'.json',path);}}
for(const [name,extra] of [['SOURCE_HASHES',['src/LiveJourney.tsx','src/journeyBackend.ts','tests/journey.test.mjs']],['SUPABASE_SOURCE_HASHES',['supabase/changes/planzo_journey.sql','supabase/migrations/20261017131023_planzo_booking_journey.sql','tools/journey-check.mjs','tools/journey-package.mjs']]]){
 const manifest=JSON.parse(await readFile('docs/backend/'+name+'.json','utf8'));for(const f of extra)manifest.files[f]='';for(const f of Object.keys(manifest.files))manifest.files[f]=digest(await readFile(f));await writeFile('docs/backend/'+name+'.json',JSON.stringify(manifest,null,2)+'\n');
}
const files=['AGENTS.md','README.md','docs/HANDOFF.md','docs/JOURNEY_HANDOFF.md','docs/backend/JOURNEY_PRESERVATION.json','docs/backend/JOURNEY_DATABASE_TESTS.json','docs/backend/JOURNEY_DEPLOYMENT.json','docs/backend/PRE_JOURNEY_SOURCE_HASHES.json','docs/backend/PRE_JOURNEY_SUPABASE_SOURCE_HASHES.json','docs/backend/SOURCE_HASHES.json','docs/backend/SUPABASE_SOURCE_HASHES.json','src/LiveApp.tsx','src/LiveHistory.tsx','src/LivePrivatePlanning.tsx','src/index.css','src/LiveJourney.tsx','src/journeyBackend.ts','tests/journey.test.mjs','supabase/changes/planzo_journey.sql','supabase/migrations/20261017131023_planzo_booking_journey.sql','tools/journey-check.mjs','tools/journey-package.mjs'];
const records=[];for(const path of files){const content=await readFile(path,'utf8');records.push({path,sha256:digest(content),content});}
const bundle={format:'planzo-reviewed-utf8-files-v1',makeFile:'4tPr5AkQO1g0L1esRvGRjz',project:'ewysgpuwvufbklesdhuj',createdAt:new Date().toISOString(),files:records};
await writeFile('.cache/planzo-journey-package.json',JSON.stringify(bundle,null,2)+'\n');console.log(JSON.stringify({records:records.length,bundle:'.cache/planzo-journey-package.json',application:38,backend:52}));
