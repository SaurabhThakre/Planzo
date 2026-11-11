import assert from 'node:assert/strict';
import {test} from 'node:test';
import {equalPaymentShares,exactPaymentShares,paymentAmount,paymentBalances,suggestedSettlements} from '../src/payments.ts';
const members=['a','b','c','d'].map(id=>({id,name:id,included:true}));
const expense=(amount=10001,payer='a',ids=['a','b','c'])=>({id:'x',source:'manual',title:'Dinner',amount_paise:amount,payer_id:payer,kind:'expense',shares:equalPaymentShares(amount,ids),voided:false,needs_review:false});
test('INR inputs retain exact paise, reject ambiguous, negative, future numeric formats and excess precision',()=>{
 assert.equal(paymentAmount('100.01'),10001);assert.equal(paymentAmount('0.01'),1);assert.equal(paymentAmount('0',true),0);assert.equal(paymentAmount('100000000'),10000000000);
 for(const value of ['0','-1','1e3','1,000','10.001','NaN','Infinity','100000000.01',''])assert.throws(()=>paymentAmount(value));
});
test('equal splitting allocates every paise in stable user-id order, independent of roster display order',()=>{
 assert.deepEqual(equalPaymentShares(100,['c','a','b']),[{user_id:'a',amount_paise:34},{user_id:'b',amount_paise:33},{user_id:'c',amount_paise:33}]);
 assert.deepEqual(equalPaymentShares(1,['b','a']),[{user_id:'a',amount_paise:1},{user_id:'b',amount_paise:0}]);
 for(const ids of [[],['a','a']])assert.throws(()=>equalPaymentShares(100,ids));
});
test('exact shares reject mismatched totals, duplicates, fractions and negatives',()=>{
 assert.deepEqual(exactPaymentShares(100,[{user_id:'b',amount_paise:30},{user_id:'a',amount_paise:70}]),[{user_id:'a',amount_paise:70},{user_id:'b',amount_paise:30}]);
 for(const shares of [[],[{user_id:'a',amount_paise:99}],[{user_id:'a',amount_paise:50},{user_id:'a',amount_paise:50}],[{user_id:'a',amount_paise:-1},{user_id:'b',amount_paise:101}],[{user_id:'a',amount_paise:100.1}]])assert.throws(()=>exactPaymentShares(100,shares));
});
test('payer owes only their selected share; people excluded from an expense acquire no debt',()=>{
 const balances=paymentBalances(members,[expense()],[]);
 assert.deepEqual(balances.map(b=>b.balance_paise),[6667,-3334,-3333,0]);assert.equal(balances.reduce((n,b)=>n+b.balance_paise,0),0);
});
test('payer can cover expenses for other travellers without participating in the split',()=>{
 assert.deepEqual(paymentBalances(members,[expense(100,'a',['b','c'])],[]).map(b=>b.balance_paise),[100,-50,-50,0]);
});
test('refunds reverse the actual recipient and selected shares without inventing a settlement',()=>{
 const e=expense(10000,'a',['a','b']);assert.deepEqual(paymentBalances(members,[e,{...expense(2000,'a',['a','b']),kind:'refund'}],[]).map(b=>b.balance_paise),[4000,-4000,0,0]);
});
test('pending, rejected and cancelled payment records cannot clear balances',()=>{
 for(const status of ['pending','rejected','cancelled'])assert.deepEqual(paymentBalances(members,[expense(10000,'a',['a','b'])],[{from_id:'b',to_id:'a',amount_paise:5000,status}]).map(b=>b.balance_paise),[5000,-5000,0,0]);
 assert.deepEqual(paymentBalances(members,[expense(10000,'a',['a','b'])],[{from_id:'b',to_id:'a',amount_paise:5000,status:'confirmed'}]).map(b=>b.balance_paise),[0,0,0,0]);
});
test('partial settlement leaves an exact outstanding balance',()=>{
 assert.deepEqual(paymentBalances(members,[expense(10000,'a',['a','b'])],[{from_id:'b',to_id:'a',amount_paise:2001,status:'confirmed'}]).map(b=>b.balance_paise),[2999,-2999,0,0]);
});
test('removed expenses and stale exact booking splits are excluded until corrected',()=>{
 assert.deepEqual(paymentBalances(members,[{...expense(),voided:true},{...expense(),needs_review:true}],[]).map(b=>b.balance_paise),[0,0,0,0]);
});
test('suggested transfers reconcile complex ledgers to the last paise',()=>{
 let seed=71;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let run=0;run<100;run++){const entries=Array.from({length:12},()=>{const ids=members.filter(()=>random()%3!==0).map(m=>m.id);return expense(random()%100000+1,members[random()%4].id,ids.length?ids:['a']);});
  const balances=paymentBalances(members,entries,[]),suggested=suggestedSettlements(balances),paid=suggested.map(s=>({...s,status:'confirmed'}));assert.equal(paymentBalances(members,entries,paid).every(b=>b.balance_paise===0),true);assert.equal(suggested.every(s=>s.from_id!==s.to_id&&s.amount_paise>0),true);}
});
test('unknown members and non-reconciling balances cannot produce suggestions',()=>{
 assert.throws(()=>paymentBalances(members,[expense(10,'outsider',['a'])],[]));assert.throws(()=>suggestedSettlements([{user_id:'a',balance_paise:1}]));
});
