const {test}=require('node:test'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const USER='33333333-3333-4333-8333-333333333333',ORG='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ORIGIN='https://profitharborai.com';
const json=(body,status=200)=>Response.json(body,{status});

test('shared routing preserves Pro acknowledgements/errors and retries Business only after an ignored event',async()=>{
 const {createSharedBusinessWorker}=await import('../worker/business-shared-runtime.mjs');let ack={received:true},code=200,proCalls=0,businessCalls=0,seenBody;
 const core={fetch:async()=>{proCalls++;return json(ack,code);}};
 const worker=createSharedBusinessWorker({core,sourceApproved:true,apiFactory:()=>({fetch:async()=>json({})}),webhookFactory:()=>({fetch:async(req,env)=>{
  businessCalls++;seenBody=await req.text();assert.equal(new URL(req.url).pathname,'/api/business/billing/webhook');assert.equal(env.BUSINESS_STRIPE_KEY,'existing-live-key');assert.equal(env.BUSINESS_STRIPE_WEBHOOK_SECRET,'existing-signature-key');return json({error:'retry'},500);
 }})});
 const env={ENABLE_BUSINESS_INTEGRATION:'true',ENABLE_BUSINESS_BILLING:'true',STRIPE_SECRET_KEY:'existing-live-key',STRIPE_WEBHOOK_SECRET_LIVE:'existing-signature-key'};
 const send=()=>worker.fetch(new Request('https://api.example/api/stripe-webhook',{method:'POST',body:'{ "unchanged" : true }'}),env);
 assert.equal((await send()).status,200);assert.equal(businessCalls,0,'completed Pro event is not processed twice');
 ack={received:true,ignored:true};assert.equal((await send()).status,500,'Business failure remains retryable');assert.equal(seenBody,'{ "unchanged" : true }');
 code=400;assert.equal((await send()).status,400);assert.equal(businessCalls,1,'Pro signature rejection never reaches Business');
 code=200;ack={unexpected:true};assert.equal((await send()).status,500);assert.equal(businessCalls,1);
 delete env.ENABLE_BUSINESS_INTEGRATION;assert.equal((await send()).status,200);assert.equal(businessCalls,1,'integration gate leaves original routing intact');assert.equal(proCalls,5);
});

test('compatibility proxy pins the existing service and forwards only required headers and allowed routes',async()=>{
 const {createBusinessApiProxy}=await import('../worker/business-api-proxy.mjs');let seen;
 const proxy=createBusinessApiProxy({fetcher:async req=>{seen=req;return json({ok:true});}});
 await proxy.fetch(new Request('https://compat.example/health'));assert.equal(seen.url,'https://profitharbor-ai-live-api.bluemagic920.workers.dev/api/business/health');
 await proxy.fetch(new Request('https://compat.example/api/business/checkout',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer verified',Cookie:'private',Host:'untrusted.example','Content-Type':'application/json'},body:'{"interval":"month"}'}));
 assert.equal(new URL(seen.url).hostname,'profitharbor-ai-live-api.bluemagic920.workers.dev');assert.equal(seen.headers.get('Authorization'),'Bearer verified');assert.equal(seen.headers.get('Cookie'),null);assert.equal(seen.headers.get('Host'),null);assert.equal(await seen.text(),'{"interval":"month"}');assert.equal(seen.redirect,'manual');
 assert.equal((await proxy.fetch(new Request('https://compat.example/api/stripe-webhook'))).status,404);
});

test('built integration uses existing credentials for checkout and preserves Pro/Business webhook isolation',async()=>{
 const {build}=require('../tools/build-business-shared-live.cjs'),originalFetch=global.fetch;
 const end=Math.floor(Date.now()/1000)+86400,secret='whsec_local_integration_fixture';let interval='month',commitFailure=false,proWrites=0,commits=0,proSubscription=false,attempt=null;
 const events=new Set(),calls=[],state={mode:'live',hasCompany:true,organizationId:ORG,eligible:true,lifetimeBusiness:false,customerId:'cus_Business1',reviewRequired:false,subscriptionStatus:null,subscriptionActive:false};
 const price=()=>({id:interval==='month'?'price_1UXk8pAQCOww3CbZm6PjdBil':'price_1UYO1JAQCOww3CbZAMWwOC7N',product:'prod_VYrsLhqHn5ddVs',livemode:true,active:true,currency:'usd',unit_amount:interval==='month'?12999:132590,recurring:{interval,interval_count:1,usage_type:'licensed'}});
 const subscription=()=>({id:proSubscription?'sub_Pro1':'sub_Business1',customer:'cus_Business1',livemode:true,status:'active',metadata:proSubscription?{ph_user_id:USER}:{ironcrest_organization_id:ORG},latest_invoice:'in_Business1',items:{has_more:false,data:[{price:proSubscription?{...price(),id:'price_1UWeMkAQCOww3CbZbJFhn4QZ'}:price(),quantity:1,current_period_end:end}]},cancel_at_period_end:false});
 const invoice=()=>({id:'in_Business1',customer:'cus_Business1',livemode:true,status:'paid',amount_remaining:0,currency:'usd',parent:{subscription_details:{subscription:'sub_Business1'}},lines:{has_more:false,data:[{quantity:1,period:{start:end-172800,end},pricing:{price_details:{price:price().id,product:price().product}},parent:{subscription_item_details:{subscription:'sub_Business1',proration:false}}}]}});
 global.fetch=async(input,init={})=>{
  const u=new URL(typeof input==='string'?input:input.url),body=init.body?JSON.parse(init.headers?.['Content-Type']==='application/x-www-form-urlencoded'?'null':init.body):null;calls.push({path:u.pathname,method:init.method||'GET',body});
  if(u.pathname==='/auth/v1/user')return json({id:USER,email:'fixture@example.com',email_confirmed_at:'2026-01-01'});
  if(u.pathname==='/rest/v1/owner_entitlements')return json([]);
  if(u.pathname==='/rest/v1/ph_subscriptions_live'){if(init.method==='POST')proWrites++;return json([]);}
  if(u.pathname==='/rest/v1/ph_stripe_events_live')return json({});
  if(u.pathname==='/rest/v1/rpc/ironcrest_business_checkout')return json(state);
  if(u.pathname==='/rest/v1/rpc/ironcrest_business_checkout_attempt'){
   if(body.p_operation==='reserve')attempt??={attemptId:ORG,interval:body.p_data.interval,origin:body.p_data.origin,expiresAt:Math.floor(Date.now()/1000)+3600,sessionId:null,customerId:state.customerId,organizationId:ORG};
   if(body.p_operation==='record')attempt.sessionId=body.p_data.sessionId;return json(attempt);
  }
  if(u.pathname==='/rest/v1/rpc/ironcrest_billing_event_operation'){
   if(body.p_mode!=='live')throw Error('Unexpected mode');
   switch(body.p_operation){case 'mapped':return json({mapped:true});case 'acquire':return json({token:ORG});case 'has_event':return json({exists:events.has(body.p_data.eventId)});case 'release':return json({ok:true});case 'commit':if(commitFailure)return json({},503);commits++;events.add(body.p_data.eventId);assert.equal(body.p_data.snapshot.business_active,true);assert.equal(body.p_data.snapshot.employee_limit,20);return json({ok:true});default:throw Error('Unexpected billing operation '+body.p_operation);}
  }
  if(u.hostname==='api.stripe.com'){
   assert.equal(new Headers(init.headers).get('Authorization'),'Bearer sk_live_existingfixture');
   if(u.pathname==='/v1/account')return json({id:'acct_1UWd63AQCOww3CbZ'});
   if(u.pathname.startsWith('/v1/prices/')){const saved=interval;interval=u.pathname.includes('UYO1J')?'year':'month';const p=price();interval=saved;return json(p);}
   if(u.pathname==='/v1/subscriptions')return json({data:[],has_more:false});
   if(u.pathname.startsWith('/v1/subscriptions/'))return json(subscription());
   if(u.pathname.startsWith('/v1/invoices/'))return json(invoice());
   if(u.pathname==='/v1/checkout/sessions'){const p=new URLSearchParams(init.body);return json({id:'cs_live_Business1',livemode:true,status:'open',expires_at:Number(p.get('expires_at')),mode:'subscription',customer:state.customerId,url:'https://checkout.stripe.com/c/pay/cs_live_Business1'});}
  }
  throw Error('Unexpected provider '+u);
 };
 try{
  const worker=(await import('data:text/javascript;base64,'+Buffer.from(build({productionApproved:true})).toString('base64'))).default;
  const env={STRIPE_SECRET_KEY:'sk_live_existingfixture',STRIPE_WEBHOOK_SECRET_LIVE:secret,SUPABASE_SERVICE_ROLE_KEY:'existing_database_fixture',ENABLE_BUSINESS_INTEGRATION:'true',ENABLE_BUSINESS_BILLING:'true',ENABLE_BUSINESS_CHECKOUT:'true',BUSINESS_WEBHOOK_READY:'true',BUSINESS_CHECKOUT_ATTEMPTS_READY:'true',BUSINESS_PRO_ACCESS_READY:'true'};
  const request=(route,method='GET',body)=>worker.fetch(new Request('https://api.example'+route,{method,headers:{Origin:ORIGIN,Authorization:'Bearer verified','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
  let r=await request('/api/business/status');assert.equal(r.status,200);assert.equal((await r.json()).billingConnectionVerified,true);
  r=await request('/api/business/checkout','POST',{interval:'month'});assert.equal(r.status,200);assert.match((await r.json()).url,/^https:\/\/checkout.stripe.com\//);
  const signed=(id,pro=false,bad=false)=>{proSubscription=pro;const event={id,type:'customer.subscription.updated',livemode:true,data:{object:subscription()}},raw=JSON.stringify(event),t=Math.floor(Date.now()/1000),signature=createHmac('sha256',secret).update(t+'.'+raw).digest('hex');return worker.fetch(new Request('https://api.example/api/stripe-webhook',{method:'POST',headers:{'Stripe-Signature':'t='+t+',v1='+(bad?'0'.repeat(64):signature)},body:raw}),env);};
  assert.equal((await signed('evt_Business1')).status,200);assert.equal(commits,1);assert.equal(proWrites,0,'Business never writes the Pro subscription table');
  assert.equal((await signed('evt_Business1')).status,200);assert.equal(commits,1,'duplicate Business delivery is not committed twice');
  assert.equal((await signed('evt_Pro1',true)).status,200);assert.equal(proWrites,1);assert.equal(commits,1,'a processed Pro event never enters Business storage');
  assert.equal((await signed('evt_Bad1',false,true)).status,400);assert.equal(commits,1);
  commitFailure=true;assert.equal((await signed('evt_BusinessRetry')).status,500,'a Business storage failure is retried by Stripe');
  assert.equal(env.BUSINESS_STRIPE_KEY,undefined);assert.equal(env.BUSINESS_DATABASE_KEY,undefined,'no copied credentials were required');
  const closed=(await import('data:text/javascript;base64,'+Buffer.from(build()).toString('base64'))).default;const before=calls.length;
  r=await closed.fetch(new Request('https://api.example/api/business/health'),env);assert.equal((await r.json()).checkoutOpen,false);assert.equal(calls.length,before,'source gate blocks integration despite environment settings');
 }finally{global.fetch=originalFetch;}
});
