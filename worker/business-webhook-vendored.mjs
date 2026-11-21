// Generated with tools/build-business-worker.cjs; production approval defaults closed.
const {createBusinessBillingWebhook}=(()=>{
// Review-only component. No production handler imports this module.
// Catalog and persistence adapters must be approved and integrated before release.
const id = (value, prefix) => typeof value === 'string' && new RegExp('^'+prefix+'_[A-Za-z0-9]+$').test(value);
const resourceId = value => typeof value === 'string' ? value : value?.id;
const statuses = new Set(['active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused']);

function businessCatalog(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw Error('Approved catalog required');
  const catalog = new Map();
  for (const entry of entries) {
    if (!entry || !id(entry.priceId,'price') || !id(entry.productId,'prod') || catalog.has(entry.priceId)
      || !['business','employee_addon','unlimited'].includes(entry.kind)
      || !['month','year'].includes(entry.interval) || !/^[a-z]{3}$/.test(entry.currency)
      || !Number.isSafeInteger(entry.unitAmount) || entry.unitAmount < 1
      || !Number.isSafeInteger(entry.employees) || entry.employees < 0 || entry.employees > 100000
      || (entry.kind === 'employee_addon' && entry.employees === 0)
      || (entry.kind === 'unlimited' && entry.employees !== 0)) throw Error('Invalid approved catalog');
    catalog.set(entry.priceId,Object.freeze({...entry}));
  }
  return catalog;
}

// Called only with a fresh Stripe snapshot, under the customer lock. Browser flags
// and subscription metadata cannot grant access or select the application owner.
function businessSnapshot(subscription, invoice, catalog, {customerId=null,livemode=null,now=Date.now()}={}) {
  if (!id(subscription?.id,'sub') || !id(customerId,'cus') || typeof livemode !== 'boolean'
    || subscription.livemode !== livemode || resourceId(subscription.customer) !== customerId
    || !statuses.has(subscription.status) || !Array.isArray(subscription.items?.data)
    || subscription.items.has_more !== false || !subscription.items.data.length) throw Error('Invalid subscription snapshot');
  let base=null, addon=null, unlimited=null;
  const seen=new Set();
  for (const item of subscription.items.data) {
    const price=item?.price, approved=catalog.get(price?.id);
    if (!approved || seen.has(price.id) || resourceId(price.product)!==approved.productId
      || price.unit_amount!==approved.unitAmount || price.livemode!==livemode
      || price.currency!==approved.currency || price.recurring?.interval!==approved.interval
      || price.recurring.interval_count!==1 || price.recurring.usage_type!=='licensed'
      || !Number.isSafeInteger(item.quantity) || item.quantity<1 || item.quantity>100000
      || !Number.isSafeInteger(item.current_period_end) || item.current_period_end<1
      || item.current_period_end>8640000000000) throw Error('Unsupported subscription items');
    seen.add(price.id);
    const record={...approved,quantity:item.quantity,end:item.current_period_end};
    if (approved.kind==='business') { if(base || item.quantity!==1)throw Error('One Business base required');base=record; }
    if (approved.kind==='employee_addon') { if(addon)throw Error('One employee add-on required');addon=record; }
    if (approved.kind==='unlimited') { if(unlimited || item.quantity!==1)throw Error('One unlimited add-on required');unlimited=record; }
  }
  if ((!base&&(!unlimited||addon)) || (addon && unlimited) || (base&&[addon,unlimited].some(x=>x&&(x.interval!==base.interval||x.currency!==base.currency)))) throw Error('Invalid Business composition');
  const principal=base||unlimited;
  const end=Math.min(principal.end,...[addon,unlimited].filter(Boolean).map(x=>x.end));
  const active=subscription.status==='active' && !subscription.pause_collection && end*1000>now;
  if (active) {
    const linked=invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription;
    if (!id(invoice?.id,'in') || resourceId(subscription.latest_invoice)!==invoice.id
      || invoice.livemode!==livemode || resourceId(invoice.customer)!==customerId
      || resourceId(linked)!==subscription.id || invoice.status!=='paid' || ('paid' in invoice && invoice.paid!==true)
      || invoice.amount_remaining!==0 || invoice.currency!==principal.currency) throw Error('Paid invoice required');
    // Flexible billing can change the current price/period before invoicing it.
    // A paid invoice for the previous plan cannot fund the newly extended term.
    if(!Array.isArray(invoice.lines?.data)||invoice.lines.has_more!==false
      ||!subscription.items.data.every(item=>invoice.lines.data.some(line=>{
        const details=line.parent?.subscription_item_details;
        return resourceId(details?.subscription)===subscription.id&&details.proration===false
          &&resourceId(line.pricing?.price_details?.price)===item.price.id
          &&resourceId(line.pricing.price_details.product)===resourceId(item.price.product)
          &&line.quantity===item.quantity&&Number.isSafeInteger(line.period?.start)
          &&line.period.start*1000<=now&&Number.isSafeInteger(line.period?.end)
          &&line.period.end>=item.current_period_end;
      })))throw Error('Paid invoice coverage required');
  }
  const employees=base?base.employees+(addon?addon.employees*addon.quantity:0):0;
  if (!Number.isSafeInteger(employees)||employees>100000)throw Error('Employee limit exceeded');
  return {stripe_subscription_id:subscription.id,stripe_customer_id:customerId,status:subscription.status,subscription_type:base?'business':'unlimited_employees',
    business_active:active&&Boolean(base),unlimited_employees:active&&Boolean(unlimited),employee_limit:active?employees:0,
    current_period_end:new Date(end*1000).toISOString(),cancel_at_period_end:subscription.cancel_at_period_end===true};
}

async function verifyBusinessSignature(raw, header, secret, {now=Date.now(),cryptoApi=crypto}={}) {
  if(typeof header!=='string'||header.length>4096||typeof secret!=='string'||!secret.startsWith('whsec_'))return false;
  const parts=header.split(',').map(x=>x.trim().split('='));
  const timestamps=parts.filter(x=>x[0]==='t');
  if(timestamps.length!==1||!/^\d{1,12}$/.test(timestamps[0][1]))return false;
  const timestamp=Number(timestamps[0][1]);if(Math.abs(now/1000-timestamp)>300)return false;
  const signatures=parts.filter(x=>x[0]==='v1'&&/^[a-f0-9]{64}$/.test(x[1]||''));
  const key=await cryptoApi.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for(const [,hex] of signatures){const bytes=Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));
    if(await cryptoApi.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw)))return true;
  }
  return false;
}

function createBusinessBillingWebhook({releaseApproved=false,catalog:entries=null,stripe=null,store=null,cryptoApi=crypto,now=()=>Date.now()}={}) {
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return async(request,env)=>{
    if(new URL(request.url).pathname!=='/api/business/billing/webhook')return null;
    if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
    if(releaseApproved!==true||env.ENABLE_BUSINESS_BILLING!=='true')return reply({error:'business_billing_not_released'},503);
    if(!['live','test'].includes(env.BUSINESS_STRIPE_MODE)||!env.BUSINESS_STRIPE_WEBHOOK_SECRET||!stripe||!store)return reply({error:'billing_unavailable'},503);
    let catalog;try{catalog=businessCatalog(entries);}catch{return reply({error:'catalog_unavailable'},503);}
    let raw,event;
    try{
      const reader=request.body?.getReader();if(!reader)throw Error();let bytes=0;raw='';const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1000000){await reader.cancel();return reply({error:'event_too_large'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();
      if(!await verifyBusinessSignature(raw,request.headers.get('Stripe-Signature'),env.BUSINESS_STRIPE_WEBHOOK_SECRET,{now:now(),cryptoApi}))throw Error();
      event=JSON.parse(raw);if(!id(event?.id,'evt')||event.livemode!==(env.BUSINESS_STRIPE_MODE==='live')||typeof event.type!=='string')throw Error();
    }catch{return reply({error:'invalid_event'},400);}
    const lifecycle=['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed','checkout.session.completed','checkout.session.async_payment_succeeded'];
    const risk=['charge.dispute.created','charge.refunded','radar.early_fraud_warning.created'];
    if(!lifecycle.includes(event.type)&&!risk.includes(event.type))return reply({received:true,ignored:true});
    let stage='event_linkage';
    try{
      // The adapter must resolve risk events through Stripe charge/payment/invoice
      // relationships, then atomically journal and suspend access pending review.
      if(risk.includes(event.type)){const receipt=await store.reconcileRisk(event,stripe);return reply({received:true,reviewRequired:receipt?.reviewRequired!==false,...(receipt?.ignored?{ignored:true}:{})});}
      const object=event.data?.object;
      if(event.type.startsWith('checkout.')&&(object?.mode!=='subscription'||!['paid','no_payment_required'].includes(object.payment_status)))return reply({received:true,ignored:true});
      const customer=resourceId(object?.customer);
      const subId=event.type.startsWith('customer.subscription.')?object?.id:resourceId(object?.parent?.subscription_details?.subscription ?? object?.subscription);
      if(!id(customer,'cus')||!id(subId,'sub'))throw Error();
      stage='customer_mapping';
      if(typeof store.isMapped==='function'&&!await store.isMapped(customer)){
        if(await stripe.isRelevantSubscription(subId,customer))throw Error('Business customer mapping pending');
        return reply({received:true,ignored:true});
      }
      // Store contract: durable per-customer serialization, immutable customer to
      // owner mapping, event deduplication, subscription replacement rejection,
      // and atomic journal + entitlement update. No lifetime/legacy row updates.
      let reviewRequired=false,ignored=false;
      stage='customer_lock';
      await store.withCustomerLock(customer,async transaction=>{
        stage='event_receipt';
        if(await transaction.hasEvent(event.id,event.type))return;
        stage='subscription_read';
        const subscription=await stripe.retrieveSubscription(subId);
        const items=subscription?.items;
        const products=[...catalog.values()].map(x=>x.productId);
        const unrelated=subscription?.id===subId&&resourceId(subscription.customer)===customer&&subscription.livemode===event.livemode
          &&Array.isArray(items?.data)&&items.has_more===false&&items.data.length>0
          &&items.data.every(x=>id(resourceId(x.price?.product),'prod'))&&!items.data.some(x=>products.includes(resourceId(x.price.product)));
        if(unrelated&&typeof transaction.isTrackedSubscription==='function'&&!await transaction.isTrackedSubscription(subId)){ignored=true;return;}
        stage='invoice_read';
        const invoice=subscription.status==='active'?await stripe.retrieveInvoice(resourceId(subscription.latest_invoice)):null;
        let snapshot;
        try{snapshot=businessSnapshot(subscription,invoice,catalog,{customerId:customer,livemode:event.livemode,now:now()});}
        catch(error){
          if(subscription?.id!==subId||resourceId(subscription.customer)!==customer||subscription.livemode!==event.livemode||typeof transaction.markReview!=='function')throw error;
          const invoiceSubscription=resourceId(invoice?.parent?.subscription_details?.subscription??invoice?.subscription);
          const pendingPayment=(error.message==='Paid invoice required'&&invoice?.status!=='paid'||error.message==='Paid invoice coverage required')&&invoice?.id===resourceId(subscription.latest_invoice)
            &&resourceId(invoice.customer)===customer&&invoiceSubscription===subId&&invoice.livemode===event.livemode&&invoice.currency===subscription.items.data[0]?.price.currency
            &&Number.isSafeInteger(invoice.amount_remaining)&&invoice.amount_remaining>=0;
          if(pendingPayment){snapshot={...businessSnapshot({...subscription,status:'past_due'},null,catalog,{customerId:customer,livemode:event.livemode,now:now()}),status:subscription.status};}
          else{await transaction.markReview({eventId:event.id,eventType:event.type,subscriptionId:subId});reviewRequired=true;return;}
        }
        const receipt=await transaction.commitEvent({eventId:event.id,eventType:event.type,snapshot});
        reviewRequired=receipt?.reviewRequired===true;
      });
      return reply({received:true,...(reviewRequired?{reviewRequired:true}:{}),...(ignored?{ignored:true}:{})});
    }catch(error){return reply({error:'billing_retry_or_reconciliation_required',stage,...(error.message==='Stripe account mismatch'?{reason:'stripe_account_mismatch'}:{}),...(/^Provider HTTP [1-5][0-9]{2}$/.test(error.message)?{providerStatus:Number(error.message.slice(-3))}:{})},500);}
  };
}

return {createBusinessBillingWebhook};
})();
const {createBusinessStripeAdapter,createBusinessBillingStore,createBusinessSupabaseRpc}=(()=>{
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const resourceId=value=>typeof value==='string'?value:value?.id;
const valid=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]+$').test(value);
async function boundedJson(response){
 if(!response.ok)throw Error('Provider HTTP '+response.status);
 const reader=response.body?.getReader();if(!reader)throw Error('Missing provider body');
 let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1000000){await reader.cancel();throw Error('Provider response too large');}text+=decoder.decode(r.value,{stream:true});}
 return JSON.parse(text+decoder.decode());
}
function createBusinessStripeAdapter({key=null,mode=null,fetcher=fetch,version='2026-10-28.endive',productIds=[],expectedAccount=null}={}){
 if(!['test','live'].includes(mode)||typeof key!=='string'||!new RegExp('^[sr]k_'+mode+'_[A-Za-z0-9]+$').test(key))throw Error('Stripe mode/key mismatch');
 const get=async(path,params)=>{
  const url=new URL('https://api.stripe.com/v1/'+path);if(params)url.search=new URLSearchParams(params).toString();
  return boundedJson(await fetcher(url.href,{headers:{Authorization:'Bearer '+key,'Stripe-Version':version},redirect:'manual',signal:AbortSignal.timeout(15000)}));
 };
 let accountCheck;
 const checkAccount=()=>accountCheck||=get('account').then(account=>{if(account?.id!==expectedAccount)throw Error('Stripe account mismatch');});
 const retrieve=async(path,id,prefix)=>{if(!valid(id,prefix))throw Error('Invalid Stripe resource');if(expectedAccount)await checkAccount();const result=await get(path+'/'+encodeURIComponent(id));if(result?.id!==id||result.livemode!==(mode==='live'))throw Error('Stripe resource mismatch');return result;};
 const stripe={retrieveSubscription:id=>retrieve('subscriptions',id,'sub'),retrieveInvoice:id=>retrieve('invoices',id,'in')};
 stripe.isRelevantSubscription=async(subscriptionId,customerId)=>{
  const s=await stripe.retrieveSubscription(subscriptionId);
  if(resourceId(s.customer)!==customerId||!Array.isArray(s.items?.data)||s.items.has_more!==false||!s.items.data.length)throw Error('Incomplete relevance check');
  if(!s.items.data.every(item=>valid(resourceId(item.price?.product),'prod')))throw Error('Unknown product linkage');
  return s.items.data.some(item=>productIds.includes(resourceId(item.price.product)));
 };
 stripe.resolveRisk=async event=>{
  const object=event.data?.object;
  let paymentIntent=resourceId(object?.payment_intent),charge;
  // Fresh charge retrieval prevents relying on a stale refund object or metadata.
  const chargeId=event.type==='charge.refunded'?object?.id:resourceId(object?.charge);
  if(chargeId){charge=await retrieve('charges',chargeId,'ch');paymentIntent=resourceId(charge.payment_intent)||paymentIntent;}
  if(!valid(paymentIntent,'pi'))throw Error('Risk payment linkage requires review');
  const found=new Map();let cursor;
  // A payment can pay multiple invoices. Bound the work; never acknowledge an incomplete traversal.
  for(let page=0;page<10;page++){
   const list=await get('invoice_payments',{'payment[type]':'payment_intent','payment[payment_intent]':paymentIntent,status:'paid',limit:'100',...(cursor?{starting_after:cursor}:{})});
   if(!Array.isArray(list?.data)||typeof list.has_more!=='boolean')throw Error('Invalid invoice-payment list');
   for(const payment of list.data){
    if(payment.payment?.type!=='payment_intent'||resourceId(payment.payment.payment_intent)!==paymentIntent)throw Error('Foreign invoice payment');
    const invoice=await stripe.retrieveInvoice(resourceId(payment.invoice));
    const subId=resourceId(invoice.parent?.subscription_details?.subscription??invoice.subscription);
    if(!subId)continue;
    const customerId=resourceId(invoice.customer);if(!valid(customerId,'cus')||!valid(subId,'sub')||(charge&&resourceId(charge.customer)!==customerId))throw Error('Risk customer mismatch');
    found.set(customerId+':'+subId,{customerId,subscriptionId:subId});
   }
   if(!list.has_more)return [...found.values()];
   cursor=list.data.at(-1)?.id;if(!valid(cursor,'inpay'))throw Error('Incomplete invoice-payment page');
  }
  throw Error('Risk pagination requires reconciliation');
 };
 return stripe;
}

function createBusinessBillingStore({rpc=null,mode=null}={}){
 if(typeof rpc!=='function'||!['test','live'].includes(mode))throw Error('Billing store configuration required');
 const call=(customer,operation,token=null,data={})=>rpc('ironcrest_billing_event_operation',{p_mode:mode,p_customer_id:customer,p_operation:operation,p_token:token,p_data:data});
 const store={async isMapped(customer){const result=await call(customer,'mapped');if(typeof result?.mapped!=='boolean')throw Error('Mapping lookup unavailable');return result.mapped;},async withCustomerLock(customer,callback){
  const lock=await call(customer,'acquire');if(!uuid.test(lock?.token||''))throw Error('Billing lock unavailable');
  try{
   return await callback({
    isTrackedSubscription:async subscriptionId=>{const result=await call(customer,'is_tracked',lock.token,{subscriptionId});if(typeof result?.tracked!=='boolean')throw Error('Subscription lookup unavailable');return result.tracked;},
    hasEvent:async(eventId,eventType)=>{const result=await call(customer,'has_event',lock.token,{eventId,eventType});if(typeof result?.exists!=='boolean')throw Error('Invalid event receipt');return result.exists;},
    commitEvent:async data=>{const result=await call(customer,'commit',lock.token,data);if(result?.ok!==true)throw Error('Event commit not verified');return result;},
    markReview:async data=>{const result=await call(customer,'review',lock.token,data);if(result?.ok!==true)throw Error('Review commit not verified');return result;}
   });
  }finally{try{await call(customer,'release',lock.token);}catch{/* Expiry fences late holders; release cannot undo a committed event. */}}
 }};
 store.reconcileRisk=async(event,stripe)=>{
  const links=await stripe.resolveRisk(event);
  if(!Array.isArray(links))throw Error('Risk linkage requires reconciliation');
  let held=0;
  // Each hold is durable; a later failure returns 500 so retries finish remaining links.
  // A risk hold covers the mapped customer's Business access, including replacement subscriptions.
  for(const link of links){
   if(!await store.isMapped(link.customerId)){
    if(await stripe.isRelevantSubscription(link.subscriptionId,link.customerId))throw Error('Business customer mapping pending');
    continue;
   }
   await store.withCustomerLock(link.customerId,async transaction=>{
    if(!await transaction.isTrackedSubscription(link.subscriptionId)&&!await stripe.isRelevantSubscription(link.subscriptionId,link.customerId))return;
    const eventId=event.id;
    if(!await transaction.hasEvent(eventId,event.type))await transaction.markReview({eventId,eventType:event.type,subscriptionId:link.subscriptionId});
    held++;
   });
  }
  return {reviewRequired:held>0,ignored:held===0};
 };
 return store;
}

function createBusinessSupabaseRpc({url=null,key=null,expectedProject=null,fetcher=fetch}={}){
 if(typeof url!=='string'||url.replace(/\/$/,'')!==expectedProject||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(expectedProject||'')||!key)throw Error('Untrusted billing database');
 return async(name,body)=>{
  if(name!=='ironcrest_billing_event_operation')throw Error('Unsupported billing RPC');
  return boundedJson(await fetcher(expectedProject+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(15000)}));
 };
}

return {createBusinessStripeAdapter,createBusinessBillingStore,createBusinessSupabaseRpc};
})();
const {LIVE_BUSINESS_PRICES}=(()=>{
// Read-only verified November 15, 2026 in ProfitHarbor AI's live Stripe account.
// Catalog data does not activate billing. Never use live IDs in sandbox requests.
const LIVE_BUSINESS_PRICES = Object.freeze([
  Object.freeze({priceId:'price_1UXk8pAQCOww3CbZm6PjdBil',productId:'prod_VYrsLhqHn5ddVs',kind:'business',interval:'month',currency:'usd',unitAmount:12999,employees:20}),
  Object.freeze({priceId:'price_1UYO1JAQCOww3CbZAMWwOC7N',productId:'prod_VYrsLhqHn5ddVs',kind:'business',interval:'year',currency:'usd',unitAmount:132590,employees:20}),
  Object.freeze({priceId:'price_1UXkBDAQCOww3CbZpXEDYoHB',productId:'prod_VYrvpTTliKAmnn',kind:'unlimited',interval:'month',currency:'usd',unitAmount:4999,employees:0})
]);

return {LIVE_BUSINESS_PRICES};
})();
const PROJECT='https://nhiqbcevcdxfzvrprgck.supabase.co';
export const SANDBOX_BUSINESS_PRICES=Object.freeze([
 {priceId:'price_1Uc5Z1AJcPWZlA8sEhP4K4Mb',productId:'prod_VdMHQOCOBLAiwX',kind:'business',interval:'month',currency:'usd',unitAmount:12999,employees:20},
 {priceId:'price_1Uc5Z2AJcPWZlA8s96n61KyL',productId:'prod_VdMHQOCOBLAiwX',kind:'business',interval:'year',currency:'usd',unitAmount:132590,employees:20}
]);
export function createBusinessBillingWorker({productionApproved=false,fetcher=fetch}={}){
 return {async fetch(request,env){
  const path=new URL(request.url).pathname,mode=env.BUSINESS_STRIPE_MODE;
  const approved=mode==='test'||(mode==='live'&&productionApproved===true);
  const enabled=approved&&env.ENABLE_BUSINESS_BILLING==='true';
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(path==='/health')return json({ok:true,service:'ironcrest-business-webhook',mode:mode==='test'?'test':mode==='live'?'live':'unconfigured',releaseGateOpen:enabled,productionApproved:productionApproved===true});
  if(path!=='/api/business/billing/webhook')return json({error:'not_found'},404);
  if(!enabled)return json({error:'business_billing_not_released'},503);
  try{
   const entries=mode==='live'?LIVE_BUSINESS_PRICES:SANDBOX_BUSINESS_PRICES;
   const stripe=createBusinessStripeAdapter({key:env.BUSINESS_STRIPE_KEY,mode,fetcher,productIds:entries.map(x=>x.productId),expectedAccount:mode==='test'?'acct_1UWd69AJcPWZlA8s':'acct_1UWd63AQCOww3CbZ'});
   const rpc=createBusinessSupabaseRpc({url:env.SUPABASE_URL,key:env.BUSINESS_DATABASE_KEY,expectedProject:PROJECT,fetcher});
   const store=createBusinessBillingStore({rpc,mode});
   const route=createBusinessBillingWebhook({releaseApproved:approved,catalog:entries,stripe,store});
   return await route(request,env);
  }catch{return json({error:'billing_configuration_unavailable'},503);}
 }};
}
// No production path can be activated by changing environment settings alone.
export default createBusinessBillingWorker();
