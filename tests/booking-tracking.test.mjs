import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bookingDraft,bookingFields,bookingCounts} from '../src/bookingTracking.ts';
const draft={status:'booked',provider_name:' Direct hotel ',amount:'4200.25',booked_by:'a',reference:' ABC ',notes:' Two rooms '};
test('shared booking amount preserves paise and is a total, with trimmed details',()=>{
 assert.deepEqual(bookingFields(draft,['a']),{status:'booked',provider_name:'Direct hotel',amount_paise:420025,booked_by:'a',reference:'ABC',notes:'Two rooms'});
 assert.equal(bookingDraft({amount_paise:420025}).amount,'4200.25');
});
test('booked requires a provider, amount and included traveller',()=>{
 for(const change of [{provider_name:' '},{amount:''},{booked_by:''},{booked_by:'outsider'}])assert.throws(()=>bookingFields({...draft,...change},['a']));
 assert.equal(bookingFields({...draft,amount:'0'},['a']).amount_paise,0);
});
test('rejects malformed, negative, overprecise or excessive money',()=>{
 for(const amount of ['-1','1e3','1,000','12.345','NaN','Infinity','100000000.01'])assert.throws(()=>bookingFields({...draft,amount},['a']));
});
test('pending details can be partial and oversized fields are rejected',()=>{
 assert.equal(bookingFields({...bookingDraft(),status:'in_progress'},[]).amount_paise,null);
 for(const change of [{provider_name:'p'.repeat(121)},{reference:'r'.repeat(121)},{notes:'n'.repeat(501)},{status:'__proto__'}])assert.throws(()=>bookingFields({...draft,...change},['a']));
});
test('progress includes unsaved and cancelled steps but excludes other plan steps',()=>{
 assert.deepEqual(bookingCounts(['a','b','c','d','e'],[{step_id:'a',status:'booked'},{step_id:'b',status:'in_progress'},{step_id:'c',status:'cancelled'},{step_id:'d',status:'not_needed'},{step_id:'old',status:'booked'}]),{booked:1,in_progress:1,cancelled:1,not_needed:1,not_booked:1});
});
