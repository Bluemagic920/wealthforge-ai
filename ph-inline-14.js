
(()=>{'use strict';
  // RELEASE GATE: requires explicit owner approval and verified server protections.
  const PH_FRONTEND_BILLING_ENABLED=true;
  window.phVerifiedPro=false;
  window.phLifetimeMembership=false;
  window.phMembershipCheckComplete=false;
  const API='https://profitharbor-ai-live-api.bluemagic920.workers.dev';
  const status=document.getElementById('phProStatus');
  const button=document.getElementById('phProUpgrade');
  if(!status||!button)return;
  button.disabled=true;
  button.textContent='Explore Pro Membership';
  let seq=0,accountPlan='free';
  async function sessionToken(){
    const sb=window.wealthforgeAuthClient;
    if(!sb?.auth?.getSession)throw Error('Sign in under Account first.');
    const {data,error}=await sb.auth.getSession();
    if(error||!data?.session?.access_token)throw Error('Sign in under Account first.');
    return data.session.access_token;
  }
  async function check(){
    const current=++seq;
    button.disabled=true;
    window.phMembershipCheckComplete=false;
    window.phVerifiedPro=false;
    window.phLifetimeMembership=false;
    status.textContent='Checking secure membership status…';
    try{
      const token=await sessionToken();
      const response=await fetch(API+'/api/billing/status',{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store'});
      let result={};try{result=await response.json()}catch{}
      if(current!==seq)return;
      if(response.status===503&&result.error==='Live billing not activated'){
        status.textContent='Secure billing connection reached. Live billing is not activated; no payment can be taken.';
        return;
      }
      if(response.status===403){status.textContent='Pro membership is not open for public checkout yet.';return;}
      if(!response.ok){status.textContent='Membership status unavailable (HTTP '+response.status+'). Checkout remains disabled.';return;}
      const lifetime=result.lifetime_pro===true && result.role==='owner'; // Verified server-side owner entitlement only
      accountPlan=lifetime?'lifetime':(result.plan==='pro'&&['active','trialing'].includes(result.status)?'pro':'free');
      window.phVerifiedPro=(accountPlan==='pro'||accountPlan==='lifetime');
      window.phLifetimeMembership=(accountPlan==='lifetime');
      window.phMembershipCheckComplete=true;
      if(accountPlan==='lifetime'){
        status.textContent='Lifetime Pro membership active. No recurring subscription is required.';
        button.textContent='Lifetime Pro — Active';
      }else if(accountPlan==='pro'){
        status.textContent='Your membership: Pro ('+result.status+').';
        button.textContent='Manage Pro Membership';
      }else{
        status.textContent='Your membership: Free. Upgrade to Pro for unlimited customers and AI assistance.';
        button.textContent='Explore Pro Membership';
      }
      // Never enable checkout from a server response alone: both gates must be released.
      if(PH_FRONTEND_BILLING_ENABLED && accountPlan!=='lifetime')button.disabled=false;
    }catch(e){if(current===seq)status.textContent=(e.message==='Sign in under Account first.'?'Sign in to check membership. ':'Secure billing connection unavailable. ')+'Checkout remains disabled.';}
  }
  button.addEventListener('click',async()=>{
    if(!PH_FRONTEND_BILLING_ENABLED || accountPlan==='lifetime' || !window.phMembershipCheckComplete)return;
    button.disabled=true;status.textContent='Preparing secure Stripe billing…';
    try{
      const token=await sessionToken();
      const endpoint=accountPlan==='pro'?'/api/stripe-portal':'/api/stripe-checkout';
      const response=await fetch(API+endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();
      if(!response.ok||typeof result.url!=='string'||!result.url.startsWith('https://'))throw Error(result.error||'Billing session unavailable.');
      const destination=new URL(result.url);
      if(accountPlan==='pro'&&destination.hostname!=='billing.stripe.com')throw Error('Unexpected billing portal destination.');
      if(accountPlan!=='pro'&&destination.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination.');
      window.location.assign(result.url);
    }catch(e){status.textContent='Unable to open billing: '+(e?.message||'Unknown error');button.disabled=false;}
  });
  document.querySelector('[data-tab="cloud"]')?.addEventListener('click',check);
  document.querySelector('[data-ph-target="cloud"]')?.addEventListener('click',()=>setTimeout(check,0));
  window.addEventListener('focus',()=>{if(!document.getElementById('cloud')?.classList.contains('hidden'))check();});
  setTimeout(check,1200);
})();
