var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ORIGINS = /* @__PURE__ */ new Set(["https://profitharborai.com", "https://www.profitharborai.com", "https://bluemagic920.github.io", "http://127.0.0.1:5501", "http://localhost:5501"]);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SOURCES = /* @__PURE__ */ new Set(["facebook", "instagram", "google", "tv", "radio", "referral", "qr", "other"]);
// Collection approval is independent of internal campaign activation.
function collectionApproved(env,id){return UUID.test(id||'')&&(env.PH_APPROVED_PUBLIC_CAMPAIGN_IDS||'').split(',').map(x=>x.trim()).includes(id);}
var TRACKING_HOST = "profitharbor-leads-api.bluemagic920.workers.dev";
function respond(body, status = 200, origin = "") {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}
__name(respond, "respond");
function configured(env) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL || "") && !!env.SUPABASE_PUBLISHABLE_KEY && !!env.SUPABASE_SERVICE_ROLE_KEY;
}
__name(configured, "configured");
/** @param {any} env @param {string} path @param {{method?: string, token?: string, body?: any, privileged?: boolean}} [options] */
async function sb(env, path, { method = "GET", token, body, privileged = false } = {}) {
  const key = privileged ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_PUBLISHABLE_KEY;
  const r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + path, {
    method,
    headers: { "apikey": key, "Authorization": `Bearer ${privileged ? key : token}`, ...body ? { "Content-Type": "application/json", "Prefer": "return=representation" } : {} },
    ...body ? { body: JSON.stringify(body) } : {},
    signal: AbortSignal.timeout(8e3)
  });
  if (!r.ok) {
    console.error("Supabase request failed", { status: r.status, path: new URL(path, env.SUPABASE_URL).pathname });
    throw new Error(`Supabase status ${r.status}`);
  }
  return r.status === 204 ? null : r.json();
}
__name(sb, "sb");
async function userFor(request, env) {
  const token = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  let user;
  try {
    user = await sb(env, "/auth/v1/user", { token });
  } catch {
    return null;
  }
  if (!UUID.test(user?.id || "") || !user.email_confirmed_at) return null;
  return { id: user.id, token };
}
__name(userFor, "userFor");
async function isPro(env, userId) {
  const entitlements = await sb(env, `/rest/v1/owner_entitlements?select=role,lifetime_pro&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { privileged: true });
  const owner = entitlements?.[0];
  if (owner?.role === "owner" && owner?.lifetime_pro === true) return true;
  if (!env.PRO_STRIPE_PRICE_ID) return false;
  const rows = await sb(env, `/rest/v1/ph_subscriptions?select=stripe_price_id,status,current_period_end&user_id=eq.${encodeURIComponent(userId)}&limit=1`, { privileged: true });
  const row = rows?.[0];
  return !!row && row.stripe_price_id === env.PRO_STRIPE_PRICE_ID && ["active", "trialing"].includes(row.status) && (!row.current_period_end || Date.parse(row.current_period_end) > Date.now());
}
__name(isPro, "isPro");
async function atomicGuard(env, kind, value, max, windowMs) {
  if (!env.PH_ATOMIC_GUARD?.idFromName || !env.PH_ATOMIC_GUARD?.get) return { status: 503 };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(kind + "|" + value));
  const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const stub = env.PH_ATOMIC_GUARD.get(env.PH_ATOMIC_GUARD.idFromName(key));
    const r = await stub.fetch("https://guard.internal/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ max, windowMs }) });
    if (r.status === 429) return { status: 429 };
    if (!r.ok) return { status: 503 };
    return { status: 200 };
  } catch {
    return { status: 503 };
  }
}
__name(atomicGuard, "atomicGuard");
var ProfitHarborAtomicGuard = class {
  static {
    __name(this, "ProfitHarborAtomicGuard");
  }
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/check") return new Response(null, { status: 404 });
    let p;
    try {
      p = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!Number.isInteger(p?.max) || p.max < 1 || p.max > 100 || !Number.isInteger(p.windowMs) || p.windowMs < 1e3 || p.windowMs > 36e5) return new Response(null, { status: 400 });
    const now = Date.now();
    const allowed = await this.state.storage.transaction(async (tx) => {
      let rec = await tx.get("bucket");
      if (!rec || !Number.isFinite(rec.until) || rec.until <= now) rec = { count: 0, until: now + p.windowMs };
      if (rec.count >= p.max) return false;
      rec.count++;
      await tx.put("bucket", rec);
      return true;
    });
    return new Response(null, { status: allowed ? 204 : 429 });
  }
};

// Email automation v1: all sending is opt-in at deployment and subscriber level.
const PH_EMAIL_TEMPLATES = Object.freeze({
  sales_welcome: {subject:'We received your ProfitHarbor AI inquiry', body:name=>`Hi ${name},\n\nThank you for contacting ProfitHarbor AI. We received your inquiry.\n\nProfitHarbor AI`},
  sales_followup_1: {subject:'See what ProfitHarbor AI can do', body:name=>`Hi ${name},\n\nThanks for your interest in ProfitHarbor AI. Explore customer management and lead intelligence at https://profitharborai.com.\n\nProfitHarbor AI`},
  sales_followup_2: {subject:'Your ProfitHarbor AI options', body:name=>`Hi ${name},\n\nIf you're still considering ProfitHarbor AI, visit https://profitharborai.com to explore our plans.\n\nProfitHarbor AI`},
  subscriber_lead_ack: {subject:'Your inquiry was received', body:name=>`Hi ${name},\n\nThank you for your inquiry. The business you contacted has received it and may follow up.\n\nAutomated acknowledgment sent using ProfitHarbor AI`}
});
const phEmailValid = v => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const phEncode = v => btoa(String.fromCharCode(...new TextEncoder().encode(v))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const phDecode = v => new TextDecoder().decode(Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0)));
async function phHmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));
}
async function phUnsubToken(env, scope, owner, email) {
  const payload = phEncode(JSON.stringify({s:scope,o:owner||null,e:email.toLowerCase(),v:1}));
  const sig = await phHmac(env.PH_EMAIL_UNSUB_SECRET,payload);
  return `${payload}.${btoa(String.fromCharCode(...sig)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
}
async function phVerifyToken(env, token) {
  if (!env.PH_EMAIL_UNSUB_SECRET || typeof token !== 'string' || token.length>1500) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra!==undefined) return null;
  const expected = await phHmac(env.PH_EMAIL_UNSUB_SECRET,payload);
  const got = Uint8Array.from(atob(signature.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
  if (got.length!==expected.length) return null;
  let diff=0; for(let i=0;i<got.length;i++) diff |= got[i]^expected[i];
  if (diff) return null;
  const data=JSON.parse(phDecode(payload));
  if (data.v!==1 || !['platform_sales','subscriber'].includes(data.s) || !phEmailValid(data.e) || (data.s==='subscriber' && !UUID.test(data.o||'')) || (data.s==='platform_sales' && data.o!==null)) return null;
  return data;
}
/** @param {any} env @param {string} path @param {{method?: string, body?: any}} [options] */
async function phDb(env,path,{method='GET',body}={}) {
  return sb(env,path,{method,body,privileged:true});
}
async function phQueue(env, data) {
  if (env.ENABLE_EMAIL_QUEUE !== 'true') return;
  try { await phDb(env,'/rest/v1/ph_email_outbox',{method:'POST',body:data}); }
  catch(e) { console.error('Email queue unavailable',String(e)); }
}
async function phSendBatch(env) {
  if (env.ENABLE_EMAIL_AUTOMATION!=='true' || env.ENABLE_EMAIL_DELIVERY!=='true') return {disabled:true,sent:0};
  if (!configured(env) || !env.RESEND_API_KEY || !env.PH_EMAIL_UNSUB_SECRET || !env.PH_EMAIL_FROM || !env.PH_EMAIL_PROCESSOR_SECRET || !env.PH_EMAIL_PUBLIC_BASE) throw Error('Email configuration incomplete');
  if (new URL(env.PH_EMAIL_PUBLIC_BASE).protocol!=='https:' || new URL(env.PH_EMAIL_PUBLIC_BASE).hostname!=='profitharbor-leads-api.bluemagic920.workers.dev') throw Error('Invalid public base URL');
  const claimed = await phDb(env,'/rest/v1/rpc/ph_email_claim_due',{method:'POST',body:{p_batch_size:5}});
  let sent=0,suppressed=0,failed=0;
  for(const item of claimed||[]) {
    let outcome='suppressed', errorCode=null, messageId=null;
    try {
      if (!PH_EMAIL_TEMPLATES[item.template_key] || !phEmailValid(item.recipient_email)) throw Error('INVALID_TEMPLATE_OR_EMAIL');
      if (item.scope==='platform_sales') {
        if (!['sales_welcome','sales_followup_1','sales_followup_2'].includes(item.template_key) || !item.sales_prospect_id) throw Error('INVALID_SALES_ITEM');
        const prospect=await phDb(env,`/rest/v1/ph_sales_prospects?select=full_name,email,inquiry_contact_consent,marketing_consent&id=eq.${item.sales_prospect_id}&limit=1`);
        if (!prospect?.[0]?.inquiry_contact_consent || prospect[0].email.toLowerCase()!==item.recipient_email.toLowerCase()) throw Error('CONSENT_MISSING');
        if (item.template_key!=='sales_welcome' && !prospect[0].marketing_consent) throw Error('MARKETING_CONSENT_MISSING');
        item._name=prospect[0].full_name;
      } else if (item.scope==='subscriber') {
        if (item.template_key!=='subscriber_lead_ack' || !UUID.test(item.owner_user_id||'') || !item.subscriber_lead_id) throw Error('INVALID_SUBSCRIBER_ITEM');
        const settings=await phDb(env,`/rest/v1/ph_subscriber_email_settings?select=enabled,approved_template_key&owner_user_id=eq.${item.owner_user_id}&limit=1`);
        if (!settings?.[0]?.enabled || settings[0].approved_template_key!==item.template_key) throw Error('SUBSCRIBER_DISABLED');
        if (!await isPro(env,item.owner_user_id)) throw Error('SUBSCRIPTION_INACTIVE');
        const lead=await phDb(env,`/rest/v1/ph_real_leads?select=full_name,email,consent,user_id&id=eq.${item.subscriber_lead_id}&limit=1`);
        if (!lead?.[0]?.consent || lead[0].user_id!==item.owner_user_id || lead[0].email.toLowerCase()!==item.recipient_email.toLowerCase()) throw Error('LEAD_CONSENT_MISSING');
        item._name=lead[0].full_name;
      } else throw Error('INVALID_SCOPE');
      const prefFilter=item.scope==='platform_sales'?'scope=eq.platform_sales':`scope=eq.subscriber&owner_user_id=eq.${item.owner_user_id}`;
      const pref=await phDb(env,`/rest/v1/ph_email_preferences?select=unsubscribed_at&${prefFilter}&recipient_email=eq.${encodeURIComponent(item.recipient_email.toLowerCase())}&limit=1`);
      if (pref?.[0]?.unsubscribed_at) throw Error('UNSUBSCRIBED');
      const template=PH_EMAIL_TEMPLATES[item.template_key];
      const unsubscribe=`${env.PH_EMAIL_PUBLIC_BASE.replace(/\/$/,'')}/api/leads/email-unsubscribe?t=${encodeURIComponent(await phUnsubToken(env,item.scope,item.owner_user_id,item.recipient_email))}`;
      const name=String(item._name||'there').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,120);
      const res=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`ph-${item.id}`},
        body:JSON.stringify({from:env.PH_EMAIL_FROM,to:[item.recipient_email],subject:template.subject,text:template.body(name)+`\n\nTo stop automated emails: ${unsubscribe}`,headers:{'List-Unsubscribe':`<${unsubscribe}>`}}),signal:AbortSignal.timeout(12000)
      });
      if (!res.ok) {errorCode=`RESEND_${res.status}`;outcome=res.status===429||res.status>=500?'retry':'failed';}
      else { const result=await res.json();messageId=result.id||null;outcome='sent'; }
    } catch(e) {errorCode=String(e?.message||e).slice(0,80);outcome=['UNSUBSCRIBED','CONSENT_MISSING','LEAD_CONSENT_MISSING','SUBSCRIBER_DISABLED','SUBSCRIPTION_INACTIVE','MARKETING_CONSENT_MISSING','INVALID_TEMPLATE_OR_EMAIL','INVALID_SALES_ITEM','INVALID_SUBSCRIBER_ITEM','INVALID_SCOPE'].includes(errorCode)?'suppressed':'retry';}
    try {
      const completed=await phDb(env,'/rest/v1/rpc/ph_email_finish_claim',{method:'POST',body:{p_id:item.id,p_attempt:item.attempts,p_lease_until:item.lease_until,p_outcome:outcome,p_message_id:messageId,p_error_code:errorCode}});
      if (completed===true) { if(outcome==='sent')sent++;else if(outcome==='suppressed')suppressed++;else failed++; }
    } catch(e) { console.error('Email completion unavailable',String(e)); }
  }
  return {claimed:claimed?.length||0,sent,suppressed,failed};
}
async function phEmailRoutes(request,env,url) {
  if (url.pathname==='/api/leads/email-process' && request.method==='POST') {
    const presented=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if (!env.PH_EMAIL_PROCESSOR_SECRET || !presented || presented.length!==env.PH_EMAIL_PROCESSOR_SECRET.length) return respond({error:'Unauthorized'},401);
    const a=new TextEncoder().encode(presented),b=new TextEncoder().encode(env.PH_EMAIL_PROCESSOR_SECRET);
    let mismatch=0;for(let i=0;i<a.length;i++) mismatch|=a[i]^b[i];
    if(mismatch) return respond({error:'Unauthorized'},401);
    try {return respond(await phSendBatch(env));} catch(e){console.error('Email processing unavailable',String(e));return respond({error:'Email processing unavailable'},503);}
  }
  if (url.pathname==='/api/leads/email-settings' && ['GET','POST'].includes(request.method)) {
    const origin=request.headers.get('Origin')||'';
    if (!ORIGINS.has(origin)) return respond({error:'Origin not allowed'},403,origin);
    if (!configured(env)) return respond({error:'Backend unavailable'},503,origin);
    const user=await userFor(request,env);
    if (!user) return respond({error:'Verified sign-in required'},401,origin);
    if (!await isPro(env,user.id)) return respond({error:'Active Pro membership required'},403,origin);
    try {
      const path=`/rest/v1/ph_subscriber_email_settings?select=enabled,approved_template_key,reply_to_email&owner_user_id=eq.${user.id}&limit=1`;
      if (request.method==='GET') {
        const rows=await phDb(env,path);
        return respond({enabled:rows?.[0]?.enabled===true,template:'subscriber_lead_ack',reply_to_email:rows?.[0]?.reply_to_email||null},200,origin);
      }
      const raw=await request.text();if(raw.length>1024) return respond({error:'Request too large'},413,origin);
      const input=JSON.parse(raw);
      if(typeof input?.enabled!=='boolean') return respond({error:'Invalid setting'},400,origin);
      // A separate verified reply-to process is required before accepting custom sender identities.
      const existing=await phDb(env,`/rest/v1/ph_subscriber_email_settings?select=owner_user_id&owner_user_id=eq.${user.id}&limit=1`);
      const data={enabled:input.enabled,approved_template_key:'subscriber_lead_ack',updated_at:new Date().toISOString()};
      if(existing?.[0]) await phDb(env,`/rest/v1/ph_subscriber_email_settings?owner_user_id=eq.${user.id}`,{method:'PATCH',body:data});
      else await phDb(env,'/rest/v1/ph_subscriber_email_settings',{method:'POST',body:{...data,owner_user_id:user.id}});
      return respond({enabled:input.enabled,template:'subscriber_lead_ack'},200,origin);
    } catch(e) {console.error('Email settings unavailable',String(e));return respond({error:'Settings unavailable'},503,origin);}
  }
  if (url.pathname==='/api/leads/email-unsubscribe') {
    const token=url.searchParams.get('t')||'';
    let data;try{data=await phVerifyToken(env,token);}catch{}
    if (!data) return new Response('Invalid unsubscribe link',{status:400,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    if(request.method==='GET') return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:1rem"><h1>Stop automated emails</h1><p>Confirm to unsubscribe this address from ${data.s==='platform_sales'?'ProfitHarbor AI':'this business’s'} automated emails.</p><form method="POST"><button style="padding:12px 20px">Unsubscribe</button></form></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
    if(request.method!=='POST') return respond({error:'Method not allowed'},405);
    try {
      const filter=data.s==='platform_sales'?`scope=eq.platform_sales`:`scope=eq.subscriber&owner_user_id=eq.${data.o}`;
      const existing=await phDb(env,`/rest/v1/ph_email_preferences?select=id&${filter}&recipient_email=eq.${encodeURIComponent(data.e)}&limit=1`);
      if(existing?.[0]) await phDb(env,`/rest/v1/ph_email_preferences?id=eq.${existing[0].id}`,{method:'PATCH',body:{unsubscribed_at:new Date().toISOString()}});
      else await phDb(env,'/rest/v1/ph_email_preferences',{method:'POST',body:{scope:data.s,owner_user_id:data.o,recipient_email:data.e,unsubscribed_at:new Date().toISOString()}});
      return new Response('You have been unsubscribed.',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    }catch(e){console.error('Unsubscribe unavailable',String(e));return respond({error:'Please try again later'},503);}
  }
  return null;
}

var worker_default = {
  async scheduled(event, env, ctx) {
    if (env.ENABLE_EMAIL_AUTOMATION==='true' && env.ENABLE_EMAIL_DELIVERY==='true') {
      ctx.waitUntil(phSendBatch(env).catch(e=>console.error('Scheduled email processing failed',String(e))));
    }
  },
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const emailResponse = await phEmailRoutes(request,env,url);
    if (emailResponse) return emailResponse;
    if (url.pathname === "/health" && request.method === "GET")
      return respond({ ok: true, service: "profitharbor-leads-api", version: "0.6.3-campaign-activation-gated", campaignActivationEnabled: env.ENABLE_PRODUCTION_CAMPAIGN_ACTIVATION === "true" && env.PH_CAMPAIGN_ACTIVATION_GUARD_READY === "true", campaignCollectionApprovalRequired: true, configured: configured(env), proPriceConfigured: !!env.PRO_STRIPE_PRICE_ID, publicCollectionEnabled: env.ENABLE_REAL_LEAD_COLLECTION === "true", atomicLimiterConfigured: !!env.PH_ATOMIC_GUARD, turnstileConfigured: !!env.PH_TURNSTILE_SECRET_KEY, emailQueueEnabled: env.ENABLE_EMAIL_QUEUE === 'true', emailDeliveryEnabled: env.ENABLE_EMAIL_AUTOMATION === 'true' && env.ENABLE_EMAIL_DELIVERY === 'true' }, 200, origin);
    if (request.method === "OPTIONS") {
      if (!ORIGINS.has(origin)) return respond({ error: "Origin not allowed" }, 403);
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600", "Vary": "Origin" } });
    }
    const trackMatch = url.pathname.match(/^\/t\/([a-f0-9]{32})$/);
    if (trackMatch && request.method === "GET") {
      if (!configured(env)) return respond({ error: "Backend not configured" }, 503);
      if (env.ENABLE_PRODUCTION_TRACKING !== "true") return respond({ error: "Tracking not enabled" }, 404);
      try {
        const code = trackMatch[1];
        const links = await sb(env, `/rest/v1/ph_tracking_links?select=id,campaign_id,user_id,destination_url,enabled&code=eq.${code}&limit=1`, { privileged: true });
        const link = links?.[0];
        if (!link || !UUID.test(link.id||'') || !UUID.test(link.user_id||'') || !UUID.test(link.campaign_id||'') || !link.enabled) return respond({ error: "Tracking link unavailable" }, 404);
        const target = new URL(link.destination_url);
        if (target.hostname.includes(":") || target.hostname.endsWith(".") || target.protocol !== "https:" || target.username || target.password || !target.hostname || target.hostname === "localhost" || target.hostname.endsWith(".localhost") || target.hostname.endsWith(".internal") || target.hostname.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(target.hostname)) return respond({ error: "Invalid destination" }, 422);
        const campaigns = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,status&user_id=eq.${encodeURIComponent(link.user_id)}&id=eq.${encodeURIComponent(link.campaign_id)}&limit=1`, { privileged: true });
        if (!campaigns?.[0] || campaigns[0].id !== link.campaign_id || campaigns[0].status !== "active") return respond({ error: "Campaign is unavailable" }, 404);
        if(!await isPro(env,link.user_id))return respond({error:"Campaign unavailable"},404);
        await sb(env, "/rest/v1/ph_tracking_clicks", { method: "POST", privileged: true, body: { link_id: link.id, campaign_id: link.campaign_id, user_id: link.user_id } });
        return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
      } catch (e) {
        console.error("Tracking redirect unavailable", String(e));
        return respond({ error: "Tracking temporarily unavailable" }, 503);
      }
    }
    if (!url.pathname.startsWith("/api/leads/")) return respond({ error: "Not found" }, 404, origin);
    if (!ORIGINS.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);
    if (!configured(env)) return respond({ error: "Backend not configured" }, 503, origin);
    if (url.pathname === "/api/leads/sales-inquiry" && request.method === "POST") {
      if (env.ENABLE_SALES_INQUIRIES !== "true") return respond({error:"Inquiries not enabled"},404,origin);
      if (!env.PH_ATOMIC_GUARD?.get || !env.PH_TURNSTILE_SECRET_KEY) return respond({error:"Submission protection unavailable"},503,origin);
      let p; try { const raw=await request.text(); if(raw.length>4096) return respond({error:"Too large"},413,origin);p=JSON.parse(raw); }catch{return respond({error:"Invalid JSON"},400,origin);}
      if(!p || typeof p!=="object" || Array.isArray(p) || String(p.website||"").trim())return respond({error:"Invalid submission"},400,origin);
      const name=typeof p.full_name==="string"?p.full_name.trim():"", email=typeof p.email==="string"?p.email.trim().toLowerCase():"", company=typeof p.company==="string"?p.company.trim():"",message=typeof p.message==="string"?p.message.trim():"", token=typeof p.turnstile_token==="string"?p.turnstile_token:"";
      if(!name || name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || company.length>120 || !message || message.length>2000 || p.inquiry_contact_consent!==true || !token || token.length>2048)return respond({error:"Invalid fields"},400,origin);
      const ip=request.headers.get("CF-Connecting-IP");if(!ip)return respond({error:"Protection unavailable"},503,origin);
      const limit=await atomicGuard(env,"sales-inquiry",ip,3,3600000);if(limit.status!==200)return respond({error:limit.status===429?"Too many submissions":"Submission protection unavailable"},limit.status,origin);
      const replay=await atomicGuard(env,"sales-challenge",token,1,300000);if(replay.status!==200)return respond({error:"Challenge reused"},replay.status===429?403:503,origin);
      try {
        const vr=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({secret:env.PH_TURNSTILE_SECRET_KEY,response:token}),signal:AbortSignal.timeout(7000)});
        if(!vr.ok)return respond({error:"Challenge unavailable"},503,origin);
        const v=await vr.json(),hosts=(env.PH_TURNSTILE_ALLOWED_HOSTS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
        if(v.success!==true || !hosts.includes(String(v.hostname||"").toLowerCase()))return respond({error:"Challenge rejected"},403,origin);
        const prospectRows = await sb(env,"/rest/v1/ph_sales_prospects",{method:"POST",privileged:true,body:{full_name:name,email,company,message,source:"website",inquiry_contact_consent:true,marketing_consent:p.marketing_consent===true,marketing_consent_at:p.marketing_consent===true?new Date().toISOString():null,consent_source:"sales-inquiry-form"}});
        if (prospectRows?.[0]?.id) {
          const pid=prospectRows[0].id;
          await phQueue(env,{scope:'platform_sales',sales_prospect_id:pid,recipient_email:email,template_key:'sales_welcome',idempotency_key:`sales-welcome-${pid}`});
          if (p.marketing_consent===true) {
            await phQueue(env,{scope:'platform_sales',sales_prospect_id:pid,recipient_email:email,template_key:'sales_followup_1',idempotency_key:`sales-followup-1-${pid}`,scheduled_at:new Date(Date.now()+3*86400000).toISOString()});
            await phQueue(env,{scope:'platform_sales',sales_prospect_id:pid,recipient_email:email,template_key:'sales_followup_2',idempotency_key:`sales-followup-2-${pid}`,scheduled_at:new Date(Date.now()+8*86400000).toISOString()});
          }
        }
        return respond({saved:true},201,origin);
      }catch(e){console.error("Sales inquiry unavailable",String(e));return respond({error:"Submission unavailable"},503,origin);}
    }
    if (url.pathname === "/api/leads/collect" && request.method === "POST") {
      if (env.ENABLE_REAL_LEAD_COLLECTION !== "true") return respond({ error: "Public collection not enabled" }, 404, origin);
      if (!configured(env) || !env.PH_ATOMIC_GUARD?.get || !env.PH_TURNSTILE_SECRET_KEY)
        return respond({ error: "Submission protection unavailable" }, 503, origin);
      let p;
      try {
        const raw = await request.text();
        if (raw.length > 4096) return respond({ error: "Request too large" }, 413, origin);
        p = JSON.parse(raw);
      } catch {
        return respond({ error: "Invalid JSON" }, 400, origin);
      }
      if (!p || typeof p !== "object" || Array.isArray(p) || String(p.website || "").trim()) return respond({ error: "Invalid submission" }, 400, origin);
      const campaign = typeof p.ph_campaign === "string" ? p.ph_campaign : "";
      const submission = typeof p.submission_id === "string" ? p.submission_id : "";
      const name = typeof p.full_name === "string" ? p.full_name.trim() : "";
      const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
      const phone = typeof p.phone === "string" ? p.phone.trim() : "";
      const message = typeof p.message === "string" ? p.message.trim() : "";
      const token = typeof p.turnstile_token === "string" ? p.turnstile_token : "";
      if (!collectionApproved(env,campaign)) return respond({error:"Campaign collection not approved"},404,origin);
      if (!UUID.test(campaign) || !UUID.test(submission) || name.length < 1 || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length > 40 || message.length > 2e3 || p.consent !== true || !token || token.length > 2048)
        return respond({ error: "Invalid fields or challenge" }, 400, origin);
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) return respond({ error: "Submission protection unavailable" }, 503, origin);
      const quota = await atomicGuard(env, "real-lead-ip", ip + "|" + campaign, 3, 6e4);
      if (quota.status !== 200) return respond({ error: "Submission temporarily unavailable" }, quota.status, origin);
      const replay = await atomicGuard(env, "real-turnstile", token, 1, 3e5);
      if (replay.status !== 200) return respond({ error: "Challenge cannot be reused" }, replay.status === 429 ? 403 : 503, origin);
      try {
        const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: env.PH_TURNSTILE_SECRET_KEY, response: token }),
          signal: AbortSignal.timeout(7e3)
        });
        if (!verification.ok) return respond({ error: "Challenge unavailable" }, 503, origin);
        const v = await verification.json();
        const hosts = (env.PH_TURNSTILE_ALLOWED_HOSTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
        if (v.success !== true || !hosts.includes(String(v.hostname || "").toLowerCase()))
          return respond({ error: "Challenge rejected" }, 403, origin);
      } catch {
        return respond({ error: "Challenge unavailable" }, 503, origin);
      }
      try {
        const rows = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,user_id,status,source&id=eq.${encodeURIComponent(campaign)}&limit=1`, { privileged: true });
        const c = rows?.[0];
        if (!Array.isArray(rows)||rows.length!==1||!c||c.id!==campaign||!UUID.test(c.user_id||'')||c.status !== "active" || !await isPro(env, c.user_id)) return respond({ error: "Campaign unavailable" }, 404, origin);
        const saved = await sb(env, "/rest/v1/ph_real_leads", { method: "POST", privileged: true, body: {
          user_id: c.user_id,
          campaign_id: c.id,
          submission_id: submission,
          full_name: name,
          email,
          phone,
          message,
          consent: true,
          source: c.source
        } });
        // Email is optional: a settings or queue failure must never turn a saved lead into an HTTP 503.
        if (saved?.[0]?.id && env.ENABLE_EMAIL_QUEUE==='true') {
          try {
            const emailSettings=await phDb(env,`/rest/v1/ph_subscriber_email_settings?select=enabled,approved_template_key&owner_user_id=eq.${c.user_id}&limit=1`);
            if(emailSettings?.[0]?.enabled===true && emailSettings[0].approved_template_key==='subscriber_lead_ack')
              await phQueue(env,{scope:'subscriber',owner_user_id:c.user_id,subscriber_lead_id:saved[0].id,recipient_email:email,template_key:'subscriber_lead_ack',idempotency_key:`lead-ack-${saved[0].id}`});
          } catch (emailError) {
            console.error('Optional lead email settings unavailable; lead already saved', String(emailError));
          }
        }
        return respond({ saved: true, submission_id: saved?.[0]?.id || null }, 201, origin);
      } catch (e) {
        console.error("Real lead submission failed", String(e));
        return respond({ error: "Submission unavailable" }, 503, origin);
      }
    }
    if (url.pathname === "/api/leads/real-report" && request.method === "GET") {
      if (!configured(env)) return respond({ error: "Backend unavailable" }, 503, origin);
      const user2 = await userFor(request, env);
      if (!user2) return respond({ error: "Verified sign-in required" }, 401, origin);
      if (!await isPro(env, user2.id)) return respond({ error: "Active Pro membership required" }, 403, origin);
      const campaign = url.searchParams.get("campaign_id") || "";
      if (!UUID.test(campaign)) return respond({ error: "Valid campaign_id required" }, 400, origin);
      try {
        const campaigns = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,name,source,status&user_id=eq.${encodeURIComponent(user2.id)}&id=eq.${encodeURIComponent(campaign)}&limit=1`, { token: user2.token });
        if (!campaigns?.[0]) return respond({ error: "Campaign not found" }, 404, origin);
        const leads = await sb(env, `/rest/v1/ph_real_leads?select=id,campaign_id,full_name,email,phone,message,source,created_at&user_id=eq.${encodeURIComponent(user2.id)}&campaign_id=eq.${encodeURIComponent(campaign)}&order=created_at.desc&limit=100`, { privileged: true });
        return respond({ campaign: campaigns[0], leads: leads || [], limit: 100 }, 200, origin);
      } catch (e) {
        console.error("Real lead report failed", String(e));
        return respond({ error: "Report unavailable" }, 503, origin);
      }
    }
    let user;
    try {
      user = await userFor(request, env);
    } catch {
      return respond({ error: "Authentication unavailable" }, 503, origin);
    }
    if (!user) return respond({ error: "Verified sign-in required" }, 401, origin);
    let pro;
    try {
      pro = await isPro(env, user.id);
    } catch {
      return respond({ error: "Membership check unavailable" }, 503, origin);
    }
    if (!pro) return respond({ error: "Active Pro membership required" }, 403, origin);
    if (url.pathname === "/api/leads/capabilities" && request.method === "GET") return respond({campaign_activation_enabled:env.ENABLE_PRODUCTION_CAMPAIGN_ACTIVATION==='true'&&env.PH_CAMPAIGN_ACTIVATION_GUARD_READY==='true',tracking_enabled:env.ENABLE_PRODUCTION_TRACKING==='true',public_collection_enabled:env.ENABLE_REAL_LEAD_COLLECTION==='true',campaign_collection_approval_required:true},200,origin);
    if (url.pathname === "/api/leads/tracking-links" && request.method === "POST") {
      let p;
      try {
        const raw = await request.text();
        if (raw.length > 2048) return respond({ error: "Request too large" }, 413, origin);
        p = JSON.parse(raw);
      } catch {
        return respond({ error: "Invalid JSON" }, 400, origin);
      }
      if(!p||Array.isArray(p)||Object.keys(p).some(k=>!['ph_campaign','destination_url'].includes(k)))return respond({error:"Invalid tracking request"},400,origin);
      const quota=await atomicGuard(env,'tracking-create',user.id,10,60000);if(quota.status!==200)return respond({error:'Tracking request limit or protection unavailable'},quota.status,origin);
      const id = typeof p?.ph_campaign === "string" ? p.ph_campaign : "";
      const dest = typeof p?.destination_url === "string" ? p.destination_url.trim() : "";
      if (!UUID.test(id) || dest.length > 1500) return respond({ error: "Invalid campaign or URL" }, 400, origin);
      let target;
      try {
        target = new URL(dest);
      } catch {
        return respond({ error: "Valid HTTPS destination required" }, 400, origin);
      }
      if (target.hostname.includes(":") || target.hostname.endsWith(".") || target.protocol !== "https:" || target.username || target.password || !target.hostname || target.hostname === "localhost" || target.hostname.endsWith(".localhost") || target.hostname.endsWith(".internal") || target.hostname.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(target.hostname)) return respond({ error: "Public HTTPS destination required" }, 400, origin);
      try {
        const campaigns = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,user_id,status&user_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(id)}&limit=2`, { token: user.token });
        if (!Array.isArray(campaigns)||campaigns.length!==1||campaigns[0].id!==id||campaigns[0].user_id!==user.id) return respond({error:'Campaign unavailable'},404,origin);
        if(campaigns[0].status!=='active')return respond({error:'Activate this campaign before creating a tracking link'},409,origin);
        const existing = await sb(env, `/rest/v1/ph_tracking_links?select=id&user_id=eq.${encodeURIComponent(user.id)}&limit=51`, { privileged: true });
        if (existing.length >= 50) return respond({ error: "Tracking link limit reached" }, 429, origin);
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const code = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        const created = await sb(env, "/rest/v1/ph_tracking_links", { method: "POST", privileged: true, body: { user_id: user.id, campaign_id: id, code, destination_url: target.toString(), enabled: true } });
        if(!Array.isArray(created)||created.length!==1||!UUID.test(created[0].id||'')||created[0].user_id!==user.id||created[0].campaign_id!==id||created[0].code!==code||created[0].destination_url!==target.toString()||created[0].enabled!==true)throw Error('Unverified tracking receipt');
        return respond({ tracking_enabled:env.ENABLE_PRODUCTION_TRACKING==='true',public_collection_enabled:env.ENABLE_REAL_LEAD_COLLECTION==='true'&&collectionApproved(env,id),tracking_url: `https://${TRACKING_HOST}/t/${code}`, campaign_id: id, destination_url: target.toString(), note: "Tracking requires ENABLE_PRODUCTION_TRACKING=true." }, 201, origin);
      } catch {
        return respond({ error: "Could not create tracking link" }, 503, origin);
      }
    }
    if (url.pathname === "/api/leads/click-summary" && request.method === "GET") {
      const id = url.searchParams.get("ph_campaign") || "";
      if (!UUID.test(id)) return respond({ error: "Invalid campaign ID" }, 400, origin);
      try {
        const campaigns = await sb(env, `/rest/v1/ph_lead_campaigns?select=id&user_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(id)}&limit=1`, { token: user.token });
        if (!campaigns?.[0]) return respond({ error: "Campaign not found" }, 404, origin);
        const clicks = await sb(env, `/rest/v1/ph_tracking_clicks?select=id&user_id=eq.${encodeURIComponent(user.id)}&campaign_id=eq.${encodeURIComponent(id)}&limit=1001`, { privileged: true });
        return respond({ campaign_id: id, clicks: clicks.length, more_than_1000: clicks.length > 1e3 }, 200, origin);
      } catch {
        return respond({ error: "Click summary unavailable" }, 503, origin);
      }
    }
    if (url.pathname === "/api/leads/attribution-preview" && request.method === "POST") {
      let p;
      try {
        const raw = await request.text();
        if (raw.length > 2048) return respond({ error: "Request too large" }, 413, origin);
        p = JSON.parse(raw);
      } catch {
        return respond({ error: "Invalid JSON" }, 400, origin);
      }
      const id = typeof p?.ph_campaign === "string" ? p.ph_campaign : "";
      if (!UUID.test(id)) return respond({ error: "Invalid campaign ID" }, 400, origin);
      try {
        const rows = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,name,source,status&user_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(id)}&limit=1`, { token: user.token });
        if (!rows?.[0]) return respond({ error: "Campaign not found for signed-in account" }, 404, origin);
        const c = rows[0];
        return respond({ valid: true, preview_only: true, lead_saved: false, public_collection_enabled: false, attribution: { campaign_id: c.id, campaign_name: c.name, source: c.source, campaign_status: c.status } }, 200, origin);
      } catch {
        return respond({ error: "Attribution preview unavailable" }, 503, origin);
      }
    }
    if (url.pathname === "/api/leads/campaigns" && request.method === "GET") {
      try {
        const rows = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,user_id,name,source,status,tracking_code,created_at,updated_at&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`, { token: user.token });
        if(!Array.isArray(rows)||rows.some(c=>!UUID.test(c.id||'')||c.user_id!==user.id||!['draft','active','paused','archived'].includes(c.status)))throw Error('Invalid campaign scope');
        return respond({campaigns:rows.map(({user_id,...c})=>({...c,public_collection_approved:collectionApproved(env,c.id)}))},200,origin);
      } catch {
        return respond({ error: "Campaign lookup unavailable" }, 503, origin);
      }
    }
    if (url.pathname === "/api/leads/campaigns" && request.method === "POST") {
      if (Number(request.headers.get("Content-Length") || 0) > 4096) return respond({ error: "Request too large" }, 413, origin);
      let p;
      try {
        const raw = await request.text();
        if (raw.length > 4096) return respond({ error: "Request too large" }, 413, origin);
        p = JSON.parse(raw);
      } catch {
        return respond({ error: "Invalid JSON" }, 400, origin);
      }
      const name = typeof p?.name === "string" ? p.name.trim() : "";
      const source = typeof p?.source === "string" ? p.source.trim().toLowerCase() : "";
      if (name.length < 1 || name.length > 120 || !SOURCES.has(source)) return respond({ error: "Invalid campaign name or source" }, 400, origin);
      try {
        const existing = await sb(env, `/rest/v1/ph_lead_campaigns?select=id&user_id=eq.${encodeURIComponent(user.id)}&limit=101`, { token: user.token });
        if (existing.length >= 100) return respond({ error: "Campaign limit reached" }, 429, origin);
        const rows = await sb(env, "/rest/v1/ph_lead_campaigns", { method: "POST", token: user.token, body: { user_id: user.id, name, source, status: "draft" } });
        return respond({ campaign: rows?.[0], note: "Draft saved; public tracking is not enabled" }, 201, origin);
      } catch {
        return respond({ error: "Campaign could not be saved" }, 503, origin);
      }
    }
    const match = url.pathname.match(/^\/api\/leads\/campaigns\/([0-9a-f-]+)$/i);
    if (match && request.method === "PATCH") {
      const id = match[1];
      if (!UUID.test(id)) return respond({ error: "Invalid campaign ID" }, 400, origin);
      if (Number(request.headers.get("Content-Length") || 0) > 4096) return respond({ error: "Request too large" }, 413, origin);
      let p;
      try {
        const raw = await request.text();
        if (raw.length > 4096) return respond({ error: "Request too large" }, 413, origin);
        p = JSON.parse(raw);
      } catch {
        return respond({ error: "Invalid JSON" }, 400, origin);
      }
      if (!p || typeof p !== "object" || Array.isArray(p) || !["rename", "pause", "resume", "archive", "activate"].includes(p.action)) return respond({ error: "Invalid action" }, 400, origin);
      try {
        if(Object.keys(p).some(k=>!['action','name','expected_updated_at'].includes(k)))return respond({error:'Unexpected campaign fields'},400,origin);
        if(p.action==='activate'){
          if((env.ENABLE_PRODUCTION_CAMPAIGN_ACTIVATION!=='true'||env.PH_CAMPAIGN_ACTIVATION_GUARD_READY!=='true'))return respond({error:'Campaign activation not enabled'},403,origin);
          if(typeof p.expected_updated_at!=='string'||!Number.isFinite(Date.parse(p.expected_updated_at)))return respond({error:'Refresh the campaign before activation'},400,origin);
          const quota=await atomicGuard(env,'campaign-activate',user.id,10,60000);if(quota.status!==200)return respond({error:'Activation protection unavailable or rate limited'},quota.status,origin);
        }
        const filter = `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`;
        const existing = await sb(env, `/rest/v1/ph_lead_campaigns?select=id,user_id,name,status,updated_at&${filter}&limit=2`, { token: user.token });
        const campaign = existing?.[0];
        if(!Array.isArray(existing)||existing.length!==1||campaign.id!==id||campaign.user_id!==user.id)return respond({error:'Campaign not found'},404,origin);
        if(p.action==='activate'&&campaign.updated_at!==p.expected_updated_at)return respond({error:'Campaign changed; refresh before activating'},409,origin);
        let changes;
        if (p.action === "rename") {
          const name = typeof p.name === "string" ? p.name.trim() : "";
          if (name.length < 1 || name.length > 120) return respond({ error: "Invalid campaign name" }, 400, origin);
          if (campaign.status === "archived") return respond({ error: "Archived campaigns cannot be edited" }, 409, origin);
          changes = { name };
        } else if (p.action === "activate") {
          if ((env.ENABLE_PRODUCTION_CAMPAIGN_ACTIVATION !== "true" || env.PH_CAMPAIGN_ACTIVATION_GUARD_READY !== "true")) return respond({ error: "Campaign activation not enabled" }, 403, origin);
          if (!["draft", "paused"].includes(campaign.status)) return respond({ error: "Campaign cannot be activated" }, 409, origin);
          changes = { status: "active" };
        } else if (p.action === "pause") {
          if (!["draft", "active"].includes(campaign.status)) return respond({ error: "Campaign cannot be paused" }, 409, origin);
          changes = { status: "paused" };
        } else if (p.action === "resume") {
          if (campaign.status !== "paused") return respond({ error: "Campaign is not paused" }, 409, origin);
          changes = { status: "draft" };
        } else {
          if (campaign.status === "archived") return respond({ error: "Already archived" }, 409, origin);
          changes = { status: "archived" };
        }
        const updated = await sb(env, `/rest/v1/ph_lead_campaigns?${filter}&status=eq.${encodeURIComponent(campaign.status)}&updated_at=eq.${encodeURIComponent(campaign.updated_at)}`, { method: "PATCH", token: user.token, privileged:p.action==='activate', body: changes });
        if (!Array.isArray(updated)||updated.length!==1||updated[0].id!==id||updated[0].user_id!==user.id||updated[0].status!==(changes.status||campaign.status)) return respond({ error: "Campaign changed; refresh and try again" }, 409, origin);
        return respond({ campaign: updated[0], note: "Campaign updated", public_collection_enabled:env.ENABLE_REAL_LEAD_COLLECTION==='true'&&collectionApproved(env,id) }, 200, origin);
      } catch {
        return respond({ error: "Campaign update unavailable" }, 503, origin);
      }
    }
    return respond({ error: "Not found" }, 404, origin);
  }
};
export {
  ProfitHarborAtomicGuard,
  worker_default as default
};
//# sourceMappingURL=worker.js.map
