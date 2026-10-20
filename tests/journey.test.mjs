import test from 'node:test';
import assert from 'node:assert/strict';
// Import the pure helpers without creating a second authenticated client.
import {readFile} from 'node:fs/promises';
const code=(await readFile(new URL('../src/journeyBackend.ts',import.meta.url),'utf8')).split('export const journeyStatus=')[1];
const helpers=await import('data:text/javascript,'+encodeURIComponent('export const journeyStatus='+code.replace(/:string\|null/g,'').replace(/:string/g,'').replace(/task:JourneyTask/,'task')));
test('Money accepts paise precision and rejects ambiguous or unsafe amounts',()=>{assert.equal(helpers.checkedMoney('123.45'),12345);assert.equal(helpers.checkedMoney('0'),0);for(const v of ['-1','1e3','1.001','INR 200','100,000','Infinity','999999999999999'])assert.throws(()=>helpers.checkedMoney(v));});
test('Only known HTTPS provider URLs can become links',()=>{assert.equal(helpers.safeSourceUrl('https://www.ksrtc.in/'),'https://www.ksrtc.in/');for(const v of ['javascript:alert(1)','https://www.ksrtc.in.evil.test/','http://www.ksrtc.in/','https://key@www.ksrtc.in/','https://evil.test/','//www.ksrtc.in/'])assert.equal(helpers.safeSourceUrl(v),null);});
test('Copyable handoff includes every required stay block and no private budget',()=>{const brief=helpers.bookingBrief({basis:{title:'TEST stay',start:'2026-11-13T16:30:00Z',end:'2026-11-15T00:30:00Z',blocks:[{start:'2026-11-13T16:30:00Z',end:'2026-11-14T00:30:00Z'},{start:'2026-11-14T16:30:00Z',end:'2026-11-15T00:30:00Z'}]}});assert.equal(brief.match(/Stay block:/g).length,2);assert(brief.includes('complete per-person share'));assert(!brief.includes('ceiling'));});
