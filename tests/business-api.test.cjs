const {test}=require('node:test'),assert=require('node:assert/strict');
const USER='33333333-3333-4333-8333-333333333333',ORG='cccccccc-cccc-4ccc-8ccc-cccccccccccc',ORIGIN='https://profitharborai.com';
const NOW=Date.UTC(2026,10,16,17,0,0);
// In-memory stand-ins for Supabase Auth, the checkout database function and Stripe.
async function fixture(overrides={}){
 const {createBusinessApi}=await import('../worker/business-api.mjs');
 const f={calls:[],state:{mode:'live',hasCompany:false,organizationId:null,eligible:true,lifetimeBusiness:false,customerId:null,reviewRequired:false,subscriptionStatus:null,subscriptionActive:false,employeeLimit:null,currentPeriodEnd:null,cancelAtPeriodEnd:false},
  user:{id:USER,email:'owner@example.com',email_confirmed_at:'2026-11-01T00:00:00Z'},pro:[],subscriptions:[],account:'acct_1UWd63AQCOww3CbZ',priceAmount:12999,rpcError:null,
  env:{ENABLE_BUSINESS_CHECKOUT:'true',BUSINESS_WEBHOOK_READY:'true',BUSINESS_CHECKOUT_ATTEMPTS_READY:'true',BUSINESS_STRIPE_MODE:'live',BUSINESS_STRIPE_KEY:'sk_live_abc123',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_x'},...overrides};
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 const fetcher=async(input,init={})=>{
  const url=new URL(input),method=init.method||'GET',body=init.body||'';f.calls.push({url,method,body,headers:init.headers||{}});
  if(url.pathname==='/auth/v1/user')return f.user?json(f.user):json({},401);
  if(url.pathname==='/rest/v1/ph_subscriptions_live')return json(f.pro);
  if(url.pathname==='/rest/v1/rpc/ironcrest_business_checkout_attempt'){
   const p=JSON.parse(body),d=p.p_data;
   if(p.p_operation==='reserve'&&!f.attempt)f.attempt={attemptId:ORG,interval:d.interval,origin:d.origin,expiresAt:NOW/1000+3600,sessionId:null,customerId:f.state.customerId,organizationId:ORG};
   if(p.p_operation==='record')f.attempt.sessionId=d.sessionId;
   if(p.p_operation==='expired')f.attempt={...f.attempt,attemptId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',sessionId:null,interval:d.interval,origin:d.origin};
   return json(f.attempt);
  }
  if(url.pathname==='/rest/v1/rpc/ironcrest_business_checkout'){
   const p=JSON.parse(body);assert.equal(p.p_user_id,USER);assert.equal(p.p_mode,f.env.BUSINESS_STRIPE_MODE);
   if(f.rpcError)return json({message:f.rpcError},400);
   if(p.p_operation==='prepare'&&!f.state.hasCompany){f.state.hasCompany=true;f.state.organizationId=ORG;f.companyName=p.p_data.companyName;}
   if(p.p_operation==='customer')f.state.customerId=p.p_data.customerId;
   return json({...f.state,mode:p.p_mode});
  }
  if(url.hostname==='api.stripe.com'){
   assert.equal(init.headers.Authorization,'Bearer '+f.env.BUSINESS_STRIPE_KEY);
   const live=f.env.BUSINESS_STRIPE_MODE==='live',params=new URLSearchParams(body);
   if(url.pathname==='/v1/account')return json({id:f.account});
   if(url.pathname.startsWith('/v1/prices/')){const id=url.pathname.split('/').pop(),year=/YO1J|Z2AJ/.test(id);return json({id,livemode:live,active:true,currency:'usd',unit_amount:year?132590:f.priceAmount,recurring:{interval:year?'year':'month',interval_count:1}});}
   if(url.pathname==='/v1/customers')return json({id:'cus_New1',livemode:live});
   if(url.pathname==='/v1/subscriptions')return json({data:f.subscriptions,has_more:false});
   if(url.pathname==='/v1/checkout/sessions') { f.session={id:'cs_1',livemode:live,status:'open',expires_at:Number(params.get('expires_at')),mode:'subscription',customer:params.get('customer'),url:f.sessionUrl||'https://checkout.stripe.com/c/pay/cs_1'}; return json(f.session); }
   if(url.pathname==='/v1/checkout/sessions/cs_1')return json(f.session);
   if(url.pathname==='/v1/billing_portal/sessions')return json({id:'bps_1',livemode:live,url:'https://billing.stripe.com/p/session/1'});
  }
  throw Error('Unexpected request '+url);
 };
 f.api=createBusinessApi({fetcher,now:()=>NOW,productionApproved:overrides.productionApproved!==false});
 f.req=(path,method='GET',body,headers={})=>f.api.fetch(new Request('https://business.example'+path,{method,headers:{Origin:ORIGIN,Authorization:'Bearer token.abc',...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),f.env);
 f.stripeCalls=()=>f.calls.filter(c=>c.url.hostname==='api.stripe.com');
 f.sessions=()=>f.calls.filter(c=>c.url.pathname==='/v1/checkout/sessions');
 return f;
}
const buy=(f,body={interval:'month',companyName:'Riley Roofing'})=>f.req('/api/business/checkout','POST',body);

test('new owner: company is created, customer mapped, and a Business checkout session returned',async()=>{
 const f=await fixture();const r=await buy(f);assert.equal(r.status,200);assert.equal((await r.json()).url,'https://checkout.stripe.com/c/pay/cs_1');
 assert.equal(f.companyName,'Riley Roofing');assert.equal(f.state.customerId,'cus_New1');
 const customer=new URLSearchParams(f.calls.find(c=>c.url.pathname==='/v1/customers').body);
 assert.equal(customer.get('metadata[ironcrest_owner_user_id]'),USER);assert.equal(customer.get('metadata[ph_user_id]'),null,'Pro webhook must not claim Business customers');
 const call=f.sessions()[0],p=new URLSearchParams(call.body);
 assert.equal(p.get('mode'),'subscription');assert.equal(p.get('customer'),'cus_New1');assert.equal(p.get('line_items[0][price]'),'price_1UXk8pAQCOww3CbZm6PjdBil');assert.equal(p.get('line_items[0][quantity]'),'1');
 assert.equal(p.get('subscription_data[metadata][ph_user_id]'),null);assert.equal(p.get('subscription_data[metadata][ironcrest_organization_id]'),ORG);
 assert.equal(p.get('success_url'),ORIGIN+'/?business=success');
 const expires=Number(p.get('expires_at'))-NOW/1000;assert.ok(expires>=3600&&expires<=5400,'expiry is deterministic and at least an hour ahead');
 assert.equal(call.headers['Idempotency-Key'],'ironcrest-business-checkout:live:'+ORG);
 const again=await buy(f);assert.equal(again.status,200);assert.equal(f.sessions().length,1,'retry retrieves the existing session');
 assert.equal(f.calls.filter(c=>c.url.pathname==='/v1/customers').length,1,'mapped customer is reused');
});
test('annual billing uses the annual price',async()=>{const f=await fixture();assert.equal((await buy(f,{interval:'year',companyName:'A'})).status,200);assert.equal(new URLSearchParams(f.sessions()[0].body).get('line_items[0][price]'),'price_1UYO1JAQCOww3CbZAMWwOC7N');});

test('monthly and annual races cannot create competing checkouts',async()=>{
 const f=await fixture();const results=await Promise.all([buy(f),buy(f,{interval:'year',companyName:'A'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.sessions().length,1);
 assert.equal(f.attempt.interval,'month');
});

test('uncertain checkout retries use the same persisted attempt and parameters',async()=>{
 const f=await fixture();await buy(f);const first=f.sessions()[0];f.attempt.sessionId=null;
 assert.equal((await buy(f)).status,200);const retry=f.sessions()[1];
 assert.equal(retry.body,first.body);assert.equal(retry.headers['Idempotency-Key'],first.headers['Idempotency-Key']);
 f.attempt.sessionId=null;f.attempt.expiresAt=NOW/1000-1;
 const r=await buy(f);assert.equal(r.status,409);assert.equal((await r.json()).code,'checkout_review');assert.equal(f.sessions().length,2);
});

test('only a verified expired session permits a fresh reservation',async()=>{
 const f=await fixture();await buy(f);f.session.status='complete';
 let r=await buy(f);assert.equal(r.status,409);assert.equal((await r.json()).code,'payment_pending');assert.equal(f.sessions().length,1);
 f.session.status='expired';r=await buy(f,{interval:'year',companyName:'A'});assert.equal(r.status,200);assert.equal(f.sessions().length,2);
 assert.notEqual(f.sessions()[0].headers['Idempotency-Key'],f.sessions()[1].headers['Idempotency-Key']);
});

test('live checkout needs explicit release approval and verified dependencies',async()=>{
 for(const flag of ['BUSINESS_WEBHOOK_READY','BUSINESS_CHECKOUT_ATTEMPTS_READY']){
  const f=await fixture();delete f.env[flag];assert.equal((await buy(f)).status,503);assert.equal(f.stripeCalls().length,0);
 }
 const f=await fixture({productionApproved:false});assert.equal((await buy(f)).status,503);assert.equal(f.stripeCalls().length,0);
});
test('test mode uses sandbox prices and never the live catalog',async()=>{
 const f=await fixture({account:'acct_1UWd69AJcPWZlA8s'});f.env.BUSINESS_STRIPE_MODE='test';f.env.BUSINESS_STRIPE_KEY='sk_test_abc123';
 assert.equal((await buy(f)).status,200);assert.equal(new URLSearchParams(f.sessions()[0].body).get('line_items[0][price]'),'price_1Uc5Z1AJcPWZlA8sEhP4K4Mb');
 assert.ok(!f.calls.some(c=>c.url.pathname==='/rest/v1/ph_subscriptions_live'),'live Pro table is not consulted in test mode');
 const s=await(await f.req('/api/business/status')).json();assert.equal(s.mode,'test');
 f.state.subscriptionActive=true;f.state.subscriptionStatus='active';const paid=await(await f.req('/api/business/status')).json();
 assert.deepEqual([paid.active,paid.workspaceAccess],[true,false],'a test payment never reports live workspace access');
});
test('closed, misconfigured or mismatched setups take no payment',async()=>{
 for(const change of [e=>{e.ENABLE_BUSINESS_CHECKOUT='false';},e=>{delete e.BUSINESS_STRIPE_MODE;},e=>{e.BUSINESS_STRIPE_KEY='sk_test_abc123';},e=>{delete e.SUPABASE_SERVICE_ROLE_KEY;}]){
  const f=await fixture();change(f.env);const r=await buy(f);assert.equal(r.status,503);assert.equal(f.stripeCalls().length,0);assert.equal(f.companyName,undefined,'no company is created while closed');}
 let f=await fixture({account:'acct_other'});assert.equal((await buy(f)).status,503);assert.equal(f.sessions().length,0);
 f=await fixture({priceAmount:999});assert.equal((await buy(f)).status,503);assert.equal(f.sessions().length,0);
 f=await fixture({sessionUrl:'https://evil.example/pay'});assert.equal((await buy(f)).status,503);
 f=await fixture();f.env.ENABLE_BUSINESS_CHECKOUT='false';const s=await(await f.req('/api/business/status')).json();assert.deepEqual([s.available,s.checkoutOpen],[true,false]);
 f=await fixture();delete f.env.BUSINESS_STRIPE_KEY;assert.deepEqual(await(await f.req('/api/business/status')).json(),{available:false,checkoutOpen:false});
});
test('requests must be signed in, from the site, and well formed',async()=>{
 let f=await fixture({user:null});assert.equal((await buy(f)).status,401);
 f=await fixture();f.user.email_confirmed_at=null;assert.equal((await buy(f)).status,401);
 f=await fixture();assert.equal((await f.req('/api/business/checkout','POST',{interval:'month'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await f.req('/api/business/checkout','GET')).status,405);assert.equal((await f.req('/api/business/status?x=1')).status,400);assert.equal((await f.req('/api/other')).status,404);
 for(const body of [{interval:'week',companyName:'A'},{interval:'month',companyName:5},{interval:'month',companyName:'A',price:'price_x'},'{bad',{interval:'month'},{interval:'month',companyName:'   '},{interval:'month',companyName:'x'.repeat(121)}])
  assert.equal((await f.req('/api/business/checkout','POST',body)).status,400,JSON.stringify(body));
 assert.equal((await f.req('/api/business/checkout','POST','x'.repeat(3000))).status,400);
 assert.equal(f.stripeCalls().length,0);assert.equal(f.companyName,undefined);
 const pre=await f.api.fetch(new Request('https://business.example/api/business/checkout',{method:'OPTIONS',headers:{Origin:ORIGIN}}),f.env);assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),ORIGIN);
});
test('accounts that must not be charged are stopped before Stripe',async()=>{
 const cases=[[s=>{s.lifetimeBusiness=true;s.hasCompany=true;},'lifetime_business'],[s=>{s.eligible=false;},'employee_account'],[s=>{s.reviewRequired=true;},'billing_review'],
  [s=>{s.subscriptionStatus='active';},'existing_subscription'],[s=>{s.subscriptionStatus='past_due';},'existing_subscription'],[s=>{s.subscriptionStatus='canceled';},'reactivation_review']];
 for(const [change,code] of cases){const f=await fixture();change(f.state);const r=await buy(f);assert.equal(r.status,409,code);assert.equal((await r.json()).code,code);assert.equal(f.stripeCalls().length,0,code);}
 let f=await fixture({pro:[{status:'active',cancel_at_period_end:false}]});let r=await buy(f);assert.equal((await r.json()).code,'pro_subscription_active');assert.equal(f.stripeCalls().length,0);assert.equal(f.companyName,undefined);
 f=await fixture({pro:[{status:'active',cancel_at_period_end:true}]});assert.equal((await buy(f)).status,200,'a Pro subscription already set to cancel does not block Business');
 f=await fixture({subscriptions:[{id:'sub_1',status:'active'}]});r=await buy(f);assert.equal((await r.json()).code,'existing_subscription');assert.equal(f.sessions().length,0,'a just-completed payment is never duplicated');
 f=await fixture({subscriptions:[{id:'sub_1',status:'canceled'}]});r=await buy(f);assert.equal((await r.json()).code,'reactivation_review');assert.equal(f.sessions().length,0);
 f=await fixture({rpcError:'Account already belongs to a company'});r=await buy(f);assert.deepEqual([r.status,(await r.json()).code],[409,'employee_account']);
 f=await fixture({rpcError:'relation does not exist'});r=await buy(f);assert.equal(r.status,503);assert.ok(!JSON.stringify(await r.json()).includes('relation'),'database details are not exposed');
});
test('status and billing portal',async()=>{
 const f=await fixture();let s=await(await f.req('/api/business/status')).json();
 assert.deepEqual([s.plan,s.active,s.checkoutOpen,s.eligible,s.canManageBilling,s.prices.month,s.prices.year,s.employeesIncluded],['none',false,true,true,false,12999,132590,20]);
 assert.equal(JSON.stringify(s).includes('cus_'),false);assert.equal((await f.req('/api/business/portal','POST',{})).status,404);
 Object.assign(f.state,{hasCompany:true,organizationId:ORG,customerId:'cus_Live1',subscriptionStatus:'active',subscriptionActive:true,currentPeriodEnd:'2026-12-16T00:00:00Z'});
 s=await(await f.req('/api/business/status')).json();assert.deepEqual([s.plan,s.active,s.workspaceAccess,s.canManageBilling,s.ironcrestUrl],['business',true,true,true,'https://ironcrest.profitharborai.com/']);
 assert.equal(JSON.stringify(s).includes('cus_Live1'),false,'customer IDs stay server-side');
 const r=await f.req('/api/business/portal','POST',{});assert.equal(r.status,200);assert.equal((await r.json()).url,'https://billing.stripe.com/p/session/1');
 const health=await(await f.api.fetch(new Request('https://business.example/health'),f.env)).json();assert.deepEqual([health.configured,health.mode,health.checkoutOpen],[true,'live',true]);
});
