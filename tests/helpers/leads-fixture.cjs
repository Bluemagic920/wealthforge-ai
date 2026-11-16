const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const uid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',stamp='2026-11-16T12:00:00Z',host='https://profitharbor-leads-api.bluemagic920.workers.dev';
function fixture(o={}){
 const calls=[],campaign={id:cid,user_id:uid,name:'ZEUS ONE – Facebook Launch',source:'facebook',status:o.status||'draft',updated_at:stamp};
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'service_fixture',PRO_STRIPE_PRICE_ID:'price_fixture',PH_CAMPAIGN_ACTIVATION_GUARD_READY:'true',PH_TURNSTILE_SECRET_KEY:'challenge_fixture',PH_TURNSTILE_ALLOWED_HOSTS:'profitharborai.com',ENABLE_PRODUCTION_CAMPAIGN_ACTIVATION:o.gated?'false':'true',ENABLE_REAL_LEAD_COLLECTION:'true',ENABLE_PRODUCTION_TRACKING:'true',PH_ATOMIC_GUARD:{idFromName:()=>'',get:()=>({fetch:async()=>new Response(null,{status:o.rateLimited?429:204})})}};
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Response,Request,URL,URLSearchParams,AbortSignal,btoa,atob,console:{error(){}},fetch:async(url,init={})=>{
  const u=new URL(url),method=init.method||'GET';calls.push({url:u,method,init});
  if(u.hostname==='challenges.cloudflare.com')return Response.json({success:true,hostname:'profitharborai.com'});
  if(u.pathname.endsWith('/ph_real_leads')&&method==='POST')return Response.json([{id:other,...JSON.parse(init.body)}]);
  if(u.pathname==='/auth/v1/user')return Response.json(o.signedOut?{}:{id:uid,email_confirmed_at:o.unverified?null:stamp});
  if(u.pathname.endsWith('/owner_entitlements'))return Response.json([{role:'owner',lifetime_pro:!o.unpaid}]);
  if(u.pathname.endsWith('/ph_subscriptions'))return Response.json([]);
  if(u.pathname.endsWith('/ph_lead_campaigns')){
   if(method==='PATCH'){
    assert.equal(u.searchParams.get('user_id'),'eq.'+uid);assert.equal(u.searchParams.get('status'),'eq.'+campaign.status);assert.equal(u.searchParams.get('updated_at'),'eq.'+stamp);
    if(o.conflict)return Response.json([]);Object.assign(campaign,JSON.parse(init.body));return Response.json([{...campaign,user_id:o.foreignReceipt?other:uid}]);
   }
   return Response.json(o.missing?[]:[{...campaign,user_id:o.foreign?other:uid}]);
  }
  if(u.pathname.endsWith('/ph_tracking_links')){
   if(method==='POST'){const b=JSON.parse(init.body);assert.equal(b.user_id,uid);assert.equal(b.campaign_id,cid);return Response.json(o.badLinkReceipt?[]:[{...b,id:other}]);}
   if(u.searchParams.has('code'))return Response.json([{id:other,campaign_id:cid,user_id:uid,destination_url:'https://profitharborai.com/',enabled:true}]);
   return Response.json([]);
  }
  if(u.pathname.endsWith('/ph_tracking_clicks'))return Response.json([{id:other}]);
  throw Error('Unexpected external call '+u.pathname);
 }});
 const source=fs.readFileSync('worker/leads-api.mjs','utf8').replace(/export \{[\s\S]*?\};/,'');vm.runInContext(source+'\nglobalThis.worker=worker_default;',context);
 const req=(path,method='GET',body,origin='https://profitharborai.com')=>context.worker.fetch(new Request(host+path,{method,headers:{'CF-Connecting-IP':'198.51.100.10',Origin:origin,Authorization:'Bearer fixture','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
 return {req,env,calls,campaign};
}

module.exports={fixture,uid,cid,other,stamp,host};
