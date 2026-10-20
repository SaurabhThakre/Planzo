import test from 'node:test';
import assert from 'node:assert/strict';
import {readAuthReturn,resolveAuthReturn} from '../src/authReturn.ts';

test('a recovery URL alone never opens the new-password form',()=>{
  const result=resolveAuthReturn(readAuthReturn('?auth=recovery',''),false,false);
  assert.equal(result.reset,false);
  assert.equal(result.route,'recovery');
  assert.match(result.message,/code/);
});
test('a verified recovery opens the new-password form',()=>{
  assert.equal(resolveAuthReturn(readAuthReturn('?auth=recovery&code=fixture',''),true,false).reset,true);
});
test('expired links are recognised in the URL fragment and return to recovery',()=>{
  const result=resolveAuthReturn(readAuthReturn('?auth=recovery','#error=access_denied&error_code=otp_expired'),false,false);
  assert.equal(result.reset,false);
  assert.equal(result.route,'recovery');
  assert.match(result.message,/expired/);
});
test('a failed session exchange cannot be rescued by the recovery URL flag',()=>{
  assert.equal(resolveAuthReturn(readAuthReturn('?auth=recovery&code=fixture',''),true,true).reset,false);
});
test('ordinary app routes are preserved and callback error text is not reflected',()=>{
  assert.equal(readAuthReturn('','#/trip/fixture/preferences').callback,false);
  const result=resolveAuthReturn(readAuthReturn('?error_description=untrusted-fixture-text',''),false,false);
  assert.equal(result.route,'signin');
  assert.equal(result.message.includes('untrusted-fixture-text'),false);
});
