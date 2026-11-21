const {test}=require('node:test'),assert=require('node:assert/strict');
const user='33333333-3333-4333-8333-333333333333',env={BUSINESS_PRO_ACCESS_READY:'true',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test'};
const good={mode:'live',hasCompany:true,eligible:true,reviewRequired:false,lifetimeBusiness:false,subscriptionActive:true,subscriptionStatus:'active',currentPeriodEnd:'2027-01-01T00:00:00Z',cancelAtPeriodEnd:false};
test('Business grants Pro only from verified live server status',async()=>{
 const {businessProAccess}=await import('../worker/business-pro-access.mjs');let calls=0;
 const fetcher=async(url,init)=>{calls++;assert.match(url,/rpc\/ironcrest_business_checkout$/);assert.deepEqual(JSON.parse(init.body),{p_mode:'live',p_user_id:user,p_operation:'status',p_data:{}});assert.equal(init.headers.Authorization,undefined);return Response.json(good);};
 const access=await businessProAccess(env,user,fetcher,()=>Date.UTC(2026,10,20));assert.equal(access.lifetime,false);assert.equal(calls,1);
 assert.equal(await businessProAccess({},user,fetcher),null);assert.equal(calls,1,'closed gate makes no database call');
 for(const change of [{hasCompany:false},{eligible:false},{reviewRequired:true},{subscriptionActive:false},{subscriptionStatus:'past_due'},{subscriptionStatus:'canceled'},{currentPeriodEnd:'invalid'},{currentPeriodEnd:'2020-01-01' }]){
  assert.equal(await businessProAccess(env,user,async()=>Response.json({...good,...change})),null,JSON.stringify(change));
 }
 await assert.rejects(businessProAccess(env,user,async()=>Response.json({...good,mode:'test'})),/receipt/);
 await assert.rejects(businessProAccess(env,user,async()=>new Response('',{status:503})),/lookup failed/);
 assert.equal((await businessProAccess(env,user,async()=>Response.json({...good,lifetimeBusiness:true}))).lifetime,true);
});

test('built Worker recognizes Business, blocks duplicate Pro sales, and preserves existing Pro access',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{build}=require('../tools/build-business-pro-access.cjs');
 const baseline=fs.readFileSync(path.join(__dirname,'helpers','pro-live-baseline.mjs'),'utf8'),candidate=build(baseline);
 assert.throws(()=>build(baseline+'\n'),/baseline changed/);
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(candidate).toString('base64'))).default;
 const originalFetch=global.fetch,calls=[];let business=good,pro=[],owner=[],businessDown=false;
 global.fetch=async(input,init={})=>{
  const u=new URL(input);calls.push(u.pathname);
  if(u.pathname==='/auth/v1/user')return Response.json({id:user,email:'verified@example.com',email_confirmed_at:'2026-01-01'});
  if(u.pathname==='/rest/v1/owner_entitlements')return Response.json(owner);
  if(u.pathname==='/rest/v1/ph_subscriptions_live')return Response.json(pro);
  if(u.pathname==='/rest/v1/rpc/ironcrest_business_checkout')return businessDown?new Response('',{status:503}):Response.json(business);
  throw Error('Unexpected request '+u.pathname);
 };
 const settings={...env,STRIPE_SECRET_KEY:'sk_live_fixture',GEMINI_API_KEY:'fixture',USAGE_KV:{get:async()=>0,put:async()=>{}}};
 const request=(route,method='GET',body)=>worker.fetch(new Request('https://api.example'+route,{method,headers:{Origin:'https://profitharborai.com',Authorization:'Bearer verified','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),settings);
 try{
  let r=await request('/api/billing/status');let status=await r.json();assert.equal(status.business,true);assert.equal(status.plan,'pro');
  r=await request('/api/stripe-checkout','POST',{});assert.equal(r.status,409);assert.match((await r.json()).error,/Business already includes Pro/);
  r=await request('/api/chat','POST',{message:''});assert.equal(r.status,400,'Business passes membership verification before input validation');
  business={...good,subscriptionActive:false,subscriptionStatus:'past_due'};
  r=await request('/api/chat','POST',{message:''});assert.equal(r.status,403,'unpaid Business cannot use Pro AI');
  businessDown=true;pro=[{stripe_price_id:'price_1UWeMkAQCOww3CbZbJFhn4QZ',status:'active',current_period_end:'2027-01-01T00:00:00Z'}];
  const reads=calls.filter(x=>x.includes('/rpc/')).length;
  r=await request('/api/billing/status');assert.equal(r.status,200);assert.equal((await r.json()).plan,'pro');
  r=await request('/api/chat','POST',{message:''});assert.equal(r.status,400,'existing Pro is preserved during Business lookup outage');
  assert.equal(calls.filter(x=>x.includes('/rpc/')).length,reads,'existing Pro does not depend on the new Business read');
  pro=[];owner=[{role:'owner',lifetime_pro:true}];r=await request('/api/billing/status');assert.equal((await r.json()).lifetime_pro,true);
 }finally{global.fetch=originalFetch;}
});
