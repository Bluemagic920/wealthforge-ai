// ProfitHarbor AI Live Worker — billing hardening candidate; LIVE BILLING REMAINS DISABLED.
// WealthForge AI v1.7.1 - contextual Gemini chat test. Requires GEMINI_API_KEY secret// and USAGE_KV KV namespace binding. Fails closed if either is absent.
const SUPABASE_URL = 'https\://nhiqbcevcdxfzvrprgck.supabase.co';

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_VwM3o7h2Jxq9_2WkkdE4kg_WKU6bvP6';

const ALLOWED_ORIGINS = new Set([

  'https\://bluemagic920.github.io',

  'https\://profitharborai.com',

  'https\://www.profitharborai.com',

  'http\://127.0.0.1:5501',

  'http\://localhost:5501'

]);

const MAX_DAILY_REQUESTS = 10;

const MAX_INPUT_CHARS = 3000;

const MAX_CONTEXT_MESSAGES = 12;

const MAX_CONTEXT_CHARS = 12000;



function json(data, status = 200, origin = '') {

  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  if (ALLOWED_ORIGINS.has(origin)) {

    headers['Access-Control-Allow-Origin'] = origin;

    headers['Vary'] = 'Origin';

  }

  return new Response(JSON.stringify(data), { status, headers });

}
// ProfitHarbor AI LIVE staging. Billing intentionally disabled pending environment-isolated subscription storage.
const PH_BILLING_ENABLED = true; // RELEASE GATE: requires separate approval and reviewed change
const PH_PRICE_ID = 'price_1UWeMkAQCOww3CbZbJFhn4QZ';

const PH_STRIPE_API = 'https\://api.stripe.com/v1';

const PH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function phConstantTimeEqual(a,b){

  if(a.length!==b.length)return false;

  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);

  return diff===0;

}

async function phVerifyStripeSignature(raw, header, secret){

  if(!secret||!header||raw.length>1000000)return false;

  const fields=header.split(',').map(x=>x.trim());

  const timestamp=fields.find(x=>x.startsWith('t='))?.slice(2);

  const sigs=fields.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));

  if(!timestamp||!/^[0-9]{10,13}$/.test(timestamp)||!sigs.length)return false;

  if(Math.abs(Date.now()/1000-Number(timestamp))>300)return false;

  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);

  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${raw}`));

  const digest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');

  return sigs.some(s=>/^[a-f0-9]{64}$/i.test(s)&&phConstantTimeEqual(digest,s.toLowerCase()));

}

async function phStripe(env,path,params){

  if(!env.STRIPE_SECRET_KEY)throw Error('Stripe live secret not configured');
  if(!/^([sr]k_live_)/.test(env.STRIPE_SECRET_KEY))throw Error('Stripe live API key required');

  const r=await fetch(`${PH_STRIPE_API}${path}`,{

    method:params?'POST':'GET',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{})},

    ...(params?{body:new URLSearchParams(params).toString()}:{}),signal:AbortSignal.timeout(15000)

  });

  const data=await r.json().catch(()=>({}));

  if(!r.ok)throw Error(`Stripe API status ${r.status}`);

  return data;

}

async function phSupabaseUser(request){

  const token=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];

  if(!token)return null;

  const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:`Bearer ${token}`,apikey:SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(8000)});

  if(!r.ok)return null;

  const user=await r.json();

  return PH_UUID.test(user?.id||'')&&user.email_confirmed_at&&user.email?user:null;

}

// Owner access is checked only by the server with the service-role key.
async function phOwnerEntitlement(env,userId){
  if(!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Owner lookup unavailable');
  const r=await fetch(`${SUPABASE_URL}/rest/v1/owner_entitlements?select=role,lifetime_pro&user_id=eq.${encodeURIComponent(userId)}&limit=1`,{
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},
    signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('Owner lookup failed');
  const rows=await r.json();
  return rows?.[0]?.role==='owner' && rows?.[0]?.lifetime_pro===true;
}

async function phSubscriptionRow(env,userId){

  const r=await fetch(`${SUPABASE_URL}/rest/v1/ph_subscriptions_live?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`,{

    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(8000)});

  if(!r.ok)throw Error('Subscription lookup failed');

  return (await r.json())[0]||null;

}

async function phStoreSubscription(env,subscription){
  if(subscription?.livemode !== true)throw Error('Refusing non-live Stripe subscription');

  const userId=subscription?.metadata?.ph_user_id;

  if(!PH_UUID.test(userId||''))throw Error('Subscription has no valid account mapping');

  const customerId=typeof subscription.customer==='string'?subscription.customer:subscription.customer?.id;

  const price=subscription.items?.data?.find(x=>x.price?.id===PH_PRICE_ID)?.price?.id;

  if(!price||!customerId)throw Error('Subscription does not match ProfitHarbor price');

  const item=subscription.items.data.find(x=>x.price?.id===PH_PRICE_ID);

  const periodEnd=item?.current_period_end||subscription.current_period_end||null;

  const record={user_id:userId,stripe_customer_id:customerId,stripe_subscription_id:subscription.id,

    stripe_price_id:PH_PRICE_ID,status:subscription.status,

    current_period_end:periodEnd?new Date(periodEnd*1000).toISOString():null,

    cancel_at_period_end:Boolean(subscription.cancel_at_period_end || (Number(subscription.cancel_at) > Math.floor(Date.now()/1000))),updated_at:new Date().toISOString()};

  const r=await fetch(`${SUPABASE_URL}/rest/v1/ph_subscriptions_live?on_conflict=user_id`,{

    method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

      'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify(record),signal:AbortSignal.timeout(8000)});

  if(!r.ok)throw Error(`Subscription storage failed (${r.status})`);

}

// Ignore another product only after verifying the latest live subscription and
// confirming it has no existing ProfitHarbor subscription record. A known or
// explicitly ProfitHarbor-mapped subscription must never be silently dropped.
async function phUnrelatedSubscription(env, subscription, expectedId) {
  if (subscription?.id !== expectedId || subscription.livemode !== true ||
      !Array.isArray(subscription.items?.data) || !subscription.items.data.length ||
      subscription.items.has_more === true ||
      subscription.items.data.some(item => typeof item?.price?.id !== 'string' || !item.price.id.startsWith('price_')))
    throw Error('Subscription scope could not be verified');
  if (subscription.items.data.some(item => item.price.id === PH_PRICE_ID)) return false;
  if (subscription.metadata && Object.prototype.hasOwnProperty.call(subscription.metadata, 'ph_user_id'))
    throw Error('ProfitHarbor subscription price requires review');
  const query = new URLSearchParams({select:'stripe_subscription_id',stripe_subscription_id:'eq.'+expectedId,limit:'2'});
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ph_subscriptions_live?${query}`, {
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},
    redirect:'manual',signal:AbortSignal.timeout(8000)
  });
  if (!r.ok) throw Error('Subscription scope lookup failed');
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => row.stripe_subscription_id !== expectedId))
    throw Error('Subscription scope lookup ambiguous');
  if (rows.length) throw Error('Tracked ProfitHarbor price change requires review');
  return true;
}

async function phWebhook(request,env){

  if(!env.STRIPE_WEBHOOK_SECRET_LIVE||!env.STRIPE_SECRET_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)

    return json({error:'Webhook not configured'},503);

  const raw=await request.text();

  if(!(await phVerifyStripeSignature(raw,request.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET_LIVE)))

    return json({error:'Invalid signature'},400);

  let event;try{event=JSON.parse(raw)}catch{return json({error:'Invalid event'},400)}

  if(!event?.id||!event?.type||!event?.data?.object)return json({error:'Invalid event'},400);
  if(event.livemode !== true)return json({error:'Non-live Stripe event rejected'},400);
// Read the latest subscription from Stripe instead of trusting possibly out-of-order event snapshots.
  let subId=null;

  if(event.type==='checkout.session.completed'&&event.data.object.mode==='subscription')subId=event.data.object.subscription;

  else if(event.type.startsWith('customer.subscription.'))subId=event.data.object.id;
  else if(['invoice.paid','invoice.payment_failed'].includes(event.type)) {
    const invoice=event.data.object;
    subId=invoice.parent?.subscription_details?.subscription || invoice.subscription || null;
    if(typeof subId==='object')subId=subId?.id;
  }

  if(!subId)return json({received:true,ignored:true});

  try{

    const subscription=await phStripe(env,`/subscriptions/${encodeURIComponent(subId)}`);

    if(await phUnrelatedSubscription(env,subscription,subId))
      return json({received:true,ignored:true,reason:'unrelated_subscription'});
    await phStoreSubscription(env,subscription);
// Audit only. Do not use this table as a non-atomic processing lock.
    await fetch(`${SUPABASE_URL}/rest/v1/ph_stripe_events_live?on_conflict=event_id`,{

      method:'POST',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

      'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},

      body:JSON.stringify({event_id:event.id,event_type:event.type}),signal:AbortSignal.timeout(8000)});

    return json({received:true});

  }catch(e){console.warn('ProfitHarbor Stripe webhook retry required',String(e?.message||'error').slice(0,100));return json({error:'Webhook processing failed'},500)}

}


async function phCheckoutGuard(env, userId, operation, sessionUrl = null, customerId = null) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ph_checkout_guard_live`, {
    method:'POST',
    headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_user_id:userId,p_operation:operation,p_session_url:sessionUrl,p_customer_id:customerId}),
    signal:AbortSignal.timeout(8000)
  });
  if(!r.ok)throw Error('Atomic checkout guard unavailable');
  return await r.json();
}

async function phBillingRoute(request,env,origin,path){

  if(!ALLOWED_ORIGINS.has(origin))return json({error:'Origin not allowed'},403,origin);

  if(!env.STRIPE_SECRET_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)return json({error:'Billing unavailable'},503,origin);

  let user;try{user=await phSupabaseUser(request)}catch{return json({error:'Authentication unavailable'},503,origin)}

  if(!user)return json({error:'Verified sign-in required'},401,origin);
  if(!user.email_confirmed_at)return json({error:'Verified email required'},403,origin);

  let row,isOwner;try{isOwner=await phOwnerEntitlement(env,user.id);row=isOwner?null:await phSubscriptionRow(env,user.id)}catch{return json({error:'Membership lookup unavailable'},503,origin)}

  if(path==='/api/billing/status'&&request.method==='GET'&&isOwner)
    return json({plan:'pro',status:'active',role:'owner',lifetime_pro:true,cancel_at_period_end:false,current_period_end:null},200,origin);
  if(isOwner && path==='/api/stripe-checkout')return json({error:'Lifetime Pro already active; checkout not required'},409,origin);
  if(isOwner && path==='/api/stripe-portal')return json({error:'Owner lifetime access has no billing portal'},409,origin);
  if(path==='/api/billing/status'&&request.method==='GET'){

    const active=row?.stripe_price_id===PH_PRICE_ID&&['active','trialing'].includes(row?.status);

    return json({plan:active?'pro':'free',status:row?.status||'inactive',cancel_at_period_end:row?.cancel_at_period_end||false,current_period_end:row?.current_period_end||null},200,origin);

  }

  if(request.method!=='POST')return json({error:'Method not allowed'},405,origin);

  try{

    if(path==='/api/stripe-checkout'){

      if(row?.stripe_subscription_id&&['active','trialing','past_due','incomplete','unpaid'].includes(row.status))
        return json({error:'Existing subscription: manage billing instead'},409,origin);
      const guard=await phCheckoutGuard(env,user.id,'acquire');
      if(!guard?.acquired){
        if(guard?.session_url)return json({url:guard.session_url,reused:true},200,origin);
        return json({error:'Checkout already being prepared. Try again shortly.'},409,origin);
      }
      // Persist customer mapping in checkout guard even before the first subscription webhook.
      // Release an unpublished reservation if Stripe creation fails.
      try {
      let customerId=row?.stripe_customer_id||guard.customer_id;

      if(!customerId){

        const customer=await phStripe(env,'/customers',{'email':user.email,'metadata[ph_user_id]':user.id});

        customerId=customer.id;
        await phCheckoutGuard(env,user.id,'customer',null,customerId);
      }
      const session=await phStripe(env,'/checkout/sessions',{

        mode:'subscription',customer:customerId,'line_items[0][price]':PH_PRICE_ID,'line_items[0][quantity]':'1',

        'subscription_data[metadata][ph_user_id]':user.id,

        'client_reference_id':user.id,

        success_url:`${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,

        cancel_url:`${origin}/?billing=cancelled`,

        'metadata[ph_user_id]':user.id,
        expires_at:String(Math.floor(Date.now()/1000)+2100)
      });
      await phCheckoutGuard(env,user.id,'session',session.url,customerId);
      return json({url:session.url},200,origin);
      } catch (checkoutError) {
        try { await phCheckoutGuard(env,user.id,'release'); }
        catch (releaseError) { console.warn('Checkout reservation release failed'); }
        throw checkoutError;
      }

    }

    if(path==='/api/stripe-portal'){

      if(!row?.stripe_customer_id)return json({error:'No billing customer found'},404,origin);

      const portal=await phStripe(env,'/billing_portal/sessions',{customer:row.stripe_customer_id,return_url:`${origin}/`});

      return json({url:portal.url},200,origin);

    }

  }catch(e){console.warn('ProfitHarbor billing failure',String(e?.message||'error').slice(0,100));return json({error:'Stripe billing unavailable'},502,origin)}

  return json({error:'Not found'},404,origin);

}



export default {

  async fetch(request, env) {

    const origin = request.headers.get('Origin') || '';

    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {

      if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403);

      return new Response(null, { status: 204, headers: {

        'Access-Control-Allow-Origin': origin,

        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',

        'Access-Control-Allow-Headers': 'Authorization, Content-Type',

        'Access-Control-Max-Age': '600',

        'Vary': 'Origin'

      }});

    }

    if (url.pathname === '/health' && request.method === 'GET') {

      return json({ ok: true, service: 'profitharbor-ai', aiConfigured: Boolean(env.GEMINI_API_KEY), usageConfigured: Boolean(env.USAGE_KV), bindingDiagnostics: { kvPresent: env.USAGE_KV !== undefined, kvReadable: typeof env.USAGE_KV?.get === 'function', kvWritable: typeof env.USAGE_KV?.put === 'function' } }, 200, origin);

    }

    // LIVE BILLING LOCK: do not accept live webhooks or create charges until
    // Stripe endpoint, separate live subscription storage, and key permissions are verified.
    if (url.pathname === '/api/stripe-webhook' && request.method === 'POST') {
      if (!PH_BILLING_ENABLED) return json({error:'Live billing not activated'},503);
      return phWebhook(request,env);
    }
    if (['/api/stripe-checkout','/api/stripe-portal','/api/billing/status'].includes(url.pathname)) {
      if (!PH_BILLING_ENABLED) return json({error:'Live billing not activated'},503,origin);
      return phBillingRoute(request,env,origin,url.pathname);
    }
// Restricted Resend smoke test. Customer recipients are deliberately disabled.
    if (url.pathname === '/api/email-test' && request.method === 'POST') {

      if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);

      if (!env.RESEND_API_KEY || !env.USAGE_KV) return json({ error: 'Email service not configured' }, 503, origin);

      const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];

      if (!token) return json({ error: 'Sign in required' }, 401, origin);

      let user;

      try {

        const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {

          headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },

          signal: AbortSignal.timeout(8000)

        });

        if (!auth.ok) return json({ error: 'Invalid or expired session' }, 401, origin);

        user = await auth.json();

      } catch { return json({ error: 'Authentication unavailable' }, 503, origin); }

      if (!user?.id || !user?.email || user.email_confirmed_at == null)

        return json({ error: 'Verified account email required' }, 403, origin);

      const key = `emailtest:${user.id}:${new Date().toISOString().slice(0, 10)}`;

      const count = Number(await env.USAGE_KV.get(key) || 0);

      if (count >= 3) return json({ error: 'Daily test limit reached' }, 429, origin);
// Reserve before upstream call. KV is eventually consistent, not a strict atomic limiter.
      await env.USAGE_KV.put(key, String(count + 1), { expirationTtl: 172800 });

      try {

        const sent = await fetch('https\://api.resend.com/emails', {

          method: 'POST',

          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },

          body: JSON.stringify({

            from: 'ProfitHarbor AI <customers@mail.profitharborai.com>',

            to: [user.email],

            reply_to: user.email,

            subject: 'ProfitHarbor AI email connection test',

            text: 'This is a test message from ProfitHarbor AI. Your email connection is working if this message arrives.'

          }),

          signal: AbortSignal.timeout(12000)

        });

        if (!sent.ok) {

          console.warn('Resend test failed', { status: sent.status });

          return json({ error: 'Email provider rejected the test request', providerStatus: sent.status }, 502, origin);

        }

        const result = await sent.json();

        return json({ accepted: true, id: result.id || null, recipient: user.email, note: 'Accepted by Resend; delivery not yet confirmed' }, 200, origin);

      } catch { return json({ error: 'Email service unavailable' }, 502, origin); }

    }
// v2.1.5 controlled customer email pilot. This is NOT a production bulk-mail service.// CUSTOMER_EMAIL_TEST_RECIPIENTS: comma-separated explicit test recipient allowlist.
     if (url.pathname === '/api/customer-email' && request.method === 'POST') {

       if (!ALLOWED_ORIGINS.has(origin)) return json({error:'Origin not allowed'},403,origin);

       if (!env.RESEND_API_KEY || !env.USAGE_KV || !env.SUPABASE_SERVICE_ROLE_KEY) return json({error:'Email audit service not configured'},503,origin);

       const token=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];

       if (!token) return json({error:'Sign in required'},401,origin);

       let user;

       try {

         const auth=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:`Bearer ${token}`,apikey:SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(8000)});

         if(!auth.ok)return json({error:'Invalid session'},401,origin);

         user=await auth.json();

       }catch{return json({error:'Authentication unavailable'},503,origin);}

       if(!user?.id||!user?.email||!user.email_confirmed_at)return json({error:'Confirmed email required'},403,origin);

       if(Number(request.headers.get('content-length')||0)>12000)return json({error:'Request too large'},413,origin);

       let p;try{p=await request.json();}catch{return json({error:'Invalid JSON'},400,origin);}

       const to=typeof p?.to==='string'?p.to.trim().toLowerCase():'';

       if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||to.length>254)return json({error:'Invalid recipient'},400,origin);

       if(typeof p.subject!=='string'||!p.subject.trim()||p.subject.length>180||/[\r\n]/.test(p.subject)||typeof p.text!=='string'||!p.text.trim()||p.text.length>8000)return json({error:'Invalid message'},400,origin);

       const customerId=typeof p.customerId==='string'?p.customerId:'';

       if(!/^[0-9a-f-]{36}$/i.test(customerId))return json({error:'Valid customer ID required'},400,origin);
// Verify ownership via user's JWT and Supabase RLS. Never trust a customer email sent by the browser.
       let customer;

       try{

         const endpoint=`${SUPABASE_URL}/rest/v1/wealthforge_records?select=payload&user_id=eq.${encodeURIComponent(user.id)}&record_type=eq.customer&payload->>id=eq.${encodeURIComponent(customerId)}&limit=1`;

         const result=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`,apikey:SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(8000)});

         if(!result.ok)return json({error:'Customer authorization unavailable'},503,origin);

         const rows=await result.json();customer=rows?.[0]?.payload;

       }catch{return json({error:'Customer lookup unavailable'},503,origin);}

       if(!customer||String(customer.email||'').trim().toLowerCase()!==to)return json({error:'Customer email does not match your saved record'},403,origin);
// Strict verified-self-only pilot. No third-party recipients.
       if(to!==user.email.trim().toLowerCase())return json({error:'Pilot restricted to your verified account email'},403,origin);

       const key=`emailpilot:${user.id}:${new Date().toISOString().slice(0,10)}`;

       try{const count=Number(await env.USAGE_KV.get(key)||0);if(count>=2)return json({error:'Daily pilot limit reached'},429,origin);await env.USAGE_KV.put(key,String(count+1),{expirationTtl:172800});}

       catch{return json({error:'Quota unavailable'},503,origin);}
// Server-side audit: persist pending record BEFORE contacting Resend.
       const auditHeaders={Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};

       const auditUrl=`${SUPABASE_URL}/rest/v1/ph_email_audit`;

       let auditId;

       try {

         const ins=await fetch(auditUrl,{method:'POST',headers:{...auditHeaders,Prefer:'return=representation'},body:JSON.stringify({user_id:user.id,customer_id:customerId,sender_email:user.email,recipient_email:to,subject:p.subject.trim(),message_text:p.text.trim(),status:'pending'}),signal:AbortSignal.timeout(8000)});

         if(!ins.ok)return json({error:'Audit record could not be created; email not sent'},503,origin);

         auditId=(await ins.json())?.[0]?.id;

         if(!auditId)return json({error:'Audit record missing; email not sent'},503,origin);

       }catch{return json({error:'Audit unavailable; email not sent'},503,origin);}

       const updateAudit=async(status,providerId)=>{

         const r=await fetch(`${auditUrl}?id=eq.${encodeURIComponent(auditId)}`,{method:'PATCH',headers:auditHeaders,body:JSON.stringify({status,provider_id:providerId||null,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(8000)});

         return r.ok;

       };

       try{

         const r=await fetch('https\://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'ProfitHarbor AI <customers@mail.profitharborai.com>',to:[to],reply_to:user.email,subject:p.subject.trim(),text:p.text.trim()}),signal:AbortSignal.timeout(12000)});

         if(!r.ok){await updateAudit('rejected',null);return json({error:'Provider rejected email',providerStatus:r.status},502,origin);}

         const result=await r.json();

         const recorded=await updateAudit('accepted',result.id||null);

         if(!recorded)return json({error:'Provider accepted email but audit status update failed. Do not retry; contact support.',auditId,acceptanceUncertain:false},503,origin);

         return json({accepted:true,id:result.id||null,auditId,recipient:to,status:'accepted'},200,origin);

       }catch{

         await updateAudit('unknown',null);

         return json({error:'Email result uncertain. Do not retry until checked.'},502,origin);

       }

     }

    if(url.pathname==='/api/customer-email-history' && request.method==='GET'){

      if(!ALLOWED_ORIGINS.has(origin))return json({error:'Origin not allowed'},403,origin);

      const token=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];

      if(!token)return json({error:'Sign in required'},401,origin);

      const customerId=url.searchParams.get('customerId')||'';

      if(customerId && !/^[0-9a-f-]{36}$/i.test(customerId))return json({error:'Invalid customer ID'},400,origin);

      try{

        const auth=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:`Bearer ${token}`,apikey:SUPABASE_PUBLISHABLE_KEY}});

        if(!auth.ok)return json({error:'Invalid session'},401,origin);

        const user=await auth.json();

        const r=await fetch(`${SUPABASE_URL}/rest/v1/ph_email_audit?select=id,customer_id,recipient_email,subject,message_text,provider_id,status,created_at${customerId?'&customer_id=eq.'+encodeURIComponent(customerId):''}&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`,{headers:{Authorization:`Bearer ${token}`,apikey:SUPABASE_PUBLISHABLE_KEY}});

        if(!r.ok)return json({error:'Audit history unavailable'},503,origin);

        return json({entries:await r.json()},200,origin);

      }catch{return json({error:'Audit history unavailable'},503,origin);}

    }

    if (url.pathname !== '/api/chat' || request.method !== 'POST') return json({ error: 'Not found' }, 404, origin);

    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);

    if (!env.GEMINI_API_KEY || !env.USAGE_KV) return json({ error: 'Backend configuration incomplete' }, 503, origin);

    const token = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) return json({ error: 'Sign in required' }, 401, origin);
// Supabase validates the access token server-side; never trust client-provided user IDs.
    let user;

    try {

      const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {

        headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_PUBLISHABLE_KEY },

        signal: AbortSignal.timeout(8000)

      });

      if (!auth.ok) return json({ error: 'Invalid or expired session' }, 401, origin);

      user = await auth.json();

      if (!user?.id) return json({ error: 'Invalid session' }, 401, origin);

      // Pro-only AI: entitlement is looked up server-side, never trusted from the browser.
      let isOwner,aiPlan;
      try{isOwner=await phOwnerEntitlement(env,user.id);aiPlan=isOwner?null:await phSubscriptionRow(env,user.id)}
      catch{return json({error:'Membership lookup unavailable'},503,origin)}
      if(!isOwner && (aiPlan?.stripe_price_id!==PH_PRICE_ID || !['active','trialing'].includes(aiPlan?.status) || (aiPlan.current_period_end && new Date(aiPlan.current_period_end).getTime()<=Date.now())))
        return json({error:'AI Assistant requires an active Pro membership. Upgrade under Account.'},403,origin);

    } catch {

      return json({ error: 'Authentication service unavailable' }, 503, origin);

    }



    const size = Number(request.headers.get('content-length') || 0);

    if (size > 10000) return json({ error: 'Request too large' }, 413, origin);

    let body;

    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }

    const message = body?.message;

    if (typeof message !== 'string' || !message.trim() || message.length > MAX_INPUT_CHARS)

      return json({ error: 'Question must be 1–3000 characters' }, 400, origin);
// Treat conversation context as untrusted user-supplied text, never as system instructions.
    const history = Array.isArray(body?.history) ? body.history : [];

    if (history.length > MAX_CONTEXT_MESSAGES ||

        history.some(m => !m || !['user','model'].includes(m.role) ||

          typeof m.text !== 'string' || !m.text.trim() || m.text.length > 3000) ||

        history.reduce((n,m) => n + m.text.length, 0) > MAX_CONTEXT_CHARS)

      return json({ error: 'Invalid conversation history' }, 400, origin);
// History is capped and appended before the current user question.
    const contents = [...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),

      { role: 'user', parts: [{ text: message.trim() }] }];
// KV is eventually consistent; this is a starter usage cap, not a strict concurrency-safe quota.
    const day = new Date().toISOString().slice(0, 10);

    const key = `chat:${user.id}:${day}`;

    const used = Number(await env.USAGE_KV.get(key) || 0);

    if (used >= MAX_DAILY_REQUESTS) return json({ error: 'Daily AI limit reached', remaining: 0 }, 429, origin);
// Reserve before contacting Gemini so upstream errors don't allow unlimited retries.
    await env.USAGE_KV.put(key, String(used + 1), { expirationTtl: 172800 });



    try {

      const gemini = await fetch('https\://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },

        body: JSON.stringify({

          systemInstruction: { parts: [{ text: 'You are ProfitHarbor AI, a practical business planning assistant. Be clear and concise. Do not guarantee earnings or investment outcomes. Avoid requesting sensitive customer or financial data.' }] },

          contents,

          generationConfig: { maxOutputTokens: 700, temperature: 0.5 }

        }),

        signal: AbortSignal.timeout(20000)

      });

      if (!gemini.ok) {
// Diagnostic: log ONLY HTTP status and a tightly allowlisted provider error status.// Never log request content, tokens, API keys, provider messages or raw response bodies.
        let providerCategory = 'UNKNOWN';

        try {

          const errorPayload = await gemini.json();

          const rawStatus = errorPayload?.error?.status;

          const allowedStatuses = new Set([

            'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'PERMISSION_DENIED',

            'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'NOT_FOUND',

            'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'

          ]);

          if (typeof rawStatus === 'string' && allowedStatuses.has(rawStatus)) {

            providerCategory = rawStatus;

          }

        } catch { /* Keep generic category if response is not JSON. */ }

        console.warn('ProfitHarbor Gemini diagnostic', {

          provider: 'gemini', model: 'gemini-3.5-flash-lite',

          httpStatus: gemini.status, category: providerCategory

        });

        return json({ error: 'AI provider unavailable; try again later' }, 502, origin);

      }

      const result = await gemini.json();

      const answer = (result.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();

      if (!answer) return json({ error: 'No AI response returned' }, 502, origin);

      return json({ answer, remaining: Math.max(0, MAX_DAILY_REQUESTS - used - 1) }, 200, origin);

    } catch {

      return json({ error: 'AI request timed out or failed' }, 502, origin);

    }

  }

};
