// Server-only read. Test-mode subscriptions never grant Pro features.
export async function businessProAccess(env,userId,fetcher=fetch,now=Date.now){
  if(env.BUSINESS_PRO_ACCESS_READY!=='true')return null;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId||''))throw Error('Invalid membership identity');
  const key=env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('Business membership unavailable');
  const r=await fetcher('https://nhiqbcevcdxfzvrprgck.supabase.co/rest/v1/rpc/ironcrest_business_checkout',{
    method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json'},
    body:JSON.stringify({p_mode:'live',p_user_id:userId,p_operation:'status',p_data:{}}),redirect:'manual',signal:AbortSignal.timeout(8000)
  });
  if(!r.ok)throw Error('Business membership lookup failed');
  const s=await r.json();
  if(s?.mode!=='live'||typeof s.hasCompany!=='boolean'||typeof s.eligible!=='boolean')throw Error('Invalid Business membership receipt');
  if(!s.hasCompany||!s.eligible||s.reviewRequired===true)return null;
  if(s.lifetimeBusiness===true)return {lifetime:true,currentPeriodEnd:null,cancelAtPeriodEnd:false};
  if(s.subscriptionActive!==true||s.subscriptionStatus!=='active'||!Number.isFinite(Date.parse(s.currentPeriodEnd))||Date.parse(s.currentPeriodEnd)<=now())return null;
  return {lifetime:false,currentPeriodEnd:s.currentPeriodEnd,cancelAtPeriodEnd:s.cancelAtPeriodEnd===true};
}
