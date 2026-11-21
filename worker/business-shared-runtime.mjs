import {createBusinessApi} from './business-api.mjs';
import {createBusinessBillingWorker} from './business-webhook-vendored.mjs';

// Business runs inside the already configured ProfitHarbor live billing Worker.
// Keys stay in that Worker; no key is copied, exposed or passed to another service.
export function createSharedBusinessWorker({core,sourceApproved=false,fetcher=fetch,
  apiFactory=createBusinessApi,webhookFactory=createBusinessBillingWorker}={}) {
  if(typeof core?.fetch!=='function')throw Error('Existing Pro service required');
  const api=apiFactory({productionApproved:sourceApproved,verifyConfiguration:true,fetcher});
  const webhook=webhookFactory({productionApproved:sourceApproved,fetcher});
  const routes=new Set(['/api/business/status','/api/business/checkout','/api/business/portal','/api/business/health']);
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return {async fetch(request,env,ctx){
    const url=new URL(request.url),ready=sourceApproved===true&&env.ENABLE_BUSINESS_INTEGRATION==='true';
    const businessEnv={...env,BUSINESS_STRIPE_MODE:'live',BUSINESS_STRIPE_KEY:env.STRIPE_SECRET_KEY,
      BUSINESS_DATABASE_KEY:env.SUPABASE_SERVICE_ROLE_KEY,
      BUSINESS_STRIPE_WEBHOOK_SECRET:env.STRIPE_WEBHOOK_SECRET_LIVE,
      SUPABASE_URL:'https://nhiqbcevcdxfzvrprgck.supabase.co'};
    if(routes.has(url.pathname)){
      if(!ready)return json({available:false,configured:false,mode:'live',checkoutOpen:false},url.pathname==='/api/business/health'?200:503);
      if(url.pathname==='/api/business/health'){url.pathname='/health';return api.fetch(new Request(url,request),businessEnv);}
      return api.fetch(request,businessEnv);
    }
    // Preserve the original Pro handler, its signature checks and its retry
    // semantics. Only events it explicitly ignores are offered to Business.
    if(url.pathname==='/api/stripe-webhook'&&request.method==='POST'&&ready&&env.ENABLE_BUSINESS_BILLING==='true'){
      const pro=await core.fetch(request.clone(),env,ctx);
      if(!pro.ok)return pro;
      let receipt;try{receipt=await pro.clone().json();}catch{return json({error:'invalid_billing_receipt'},500);}
      if(receipt?.received!==true)return json({error:'invalid_billing_receipt'},500);
      if(receipt.ignored!==true)return pro;
      url.pathname='/api/business/billing/webhook';
      return webhook.fetch(new Request(url,request),businessEnv);
    }
    return core.fetch(request,env,ctx);
  }};
}
