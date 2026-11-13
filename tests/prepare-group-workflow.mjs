import fs from 'node:fs';
import {routeFixture} from './route-fixture.mjs';
// Prepare a future-dated deterministic route for rollback-only hosted RPC checks.
// This writes SQL only: execution is an explicit, separate database test step.
const start=new Date(Date.now()+30*86400000);start.setUTCHours(0,0,0,0);
const {ctx,x}=routeFixture(start.toISOString().replace('.000Z','Z'));
const sql=fs.readFileSync('tests/group-workflow.hosted.sql','utf8').replaceAll('__START__',ctx.start).replaceAll('__END__',ctx.end).replace('__CHOICE__',JSON.stringify(x).replaceAll("'","''"));
fs.mkdirSync('.cache',{recursive:true});
fs.writeFileSync('.cache/group-workflow-run.sql',sql);
console.log(JSON.stringify({path:'.cache/group-workflow-run.sql',bytes:Buffer.byteLength(sql),start:ctx.start,end:ctx.end}));
