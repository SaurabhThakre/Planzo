import fs from 'node:fs';
import {build} from 'rolldown';
import {spawnSync} from 'node:child_process';
fs.mkdirSync('.cache',{recursive:true});
await build({input:'tests/planning-clarity.render.tsx',platform:'node',external:['react','react/jsx-runtime','react-dom/server','@supabase/supabase-js'],moduleTypes:{'.css':'empty'},transform:{jsx:'react-jsx',define:{'import.meta.env.BASE_URL':'"/"'}},output:{file:'.cache/clarity-render-tests.mjs',format:'esm'}});
const result=spawnSync(process.execPath,['--test','.cache/clarity-render-tests.mjs'],{stdio:'inherit'});process.exitCode=result.status??1;
