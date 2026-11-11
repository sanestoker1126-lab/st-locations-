const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../st-remesas-connectors.js');
test('sources use HTTPS and proper encoding', () => {
 const v = c.buildSearchUrls({name:'La Tienda & MÁS',address:'101 Main St, Little Rock, AR'});
 assert.equal(Object.keys(v).length,8);
 for(const s of Object.values(v)){const u=new URL(s);assert.equal(u.protocol,'https:');assert.ok(s.includes('%20')||s.includes('%26'));}
 assert.ok(v.maps.includes('La%20Tienda%20%26%20M%C3%81S'));
});
test('no arbitrary external domains or javascript',()=>{
 assert.deepEqual(c.buildSearchUrls({name:'',address:''}),{});
 assert.throws(()=>c.browserIntent('javascript:alert(1)','com.android.chrome'));
 assert.throws(()=>c.browserIntent('http://example.com','com.android.chrome'));
 assert.throws(()=>c.browserIntent('https://example.com','com.malware'));
});
test('browser intents have safe fallback',()=>{
 const url='https://www.google.com/maps/search/?api=1&query=hello%20world';
 for(const pkg of ['com.android.chrome','com.opera.browser']){
  const intent=c.browserIntent(url,pkg);
  assert.ok(intent.startsWith('intent://www.google.com/maps/search/'));
  assert.ok(intent.includes(`package=${pkg}`));
  assert.ok(intent.includes('S.browser_fallback_url=https%3A%2F%2F'));
 }
});
test('phone normalization excludes invalid',()=>{
 assert.equal(c.cleanPhone('(501) 480-2089'),'5014802089');
 assert.equal(c.cleanPhone('+1 (501) 480-2089'),'+15014802089');
 for(const v of ['555','123-ABC','', '12345678901234567']) assert.equal(c.cleanPhone(v),'');
});
test('no auto calling or unauthorized networking',()=>{
 const fs=require('node:fs');const js=fs.readFileSync(require('node:path').join(__dirname,'../site/st-remesas-connectors.js'),'utf8');
 assert.ok(js.includes('MutationObserver'));
 assert.ok(!/\bfetch\(/.test(js));
 assert.ok(!/\bXMLHttpRequest\b/.test(js));
 assert.ok(!js.includes('localStorage'));
});