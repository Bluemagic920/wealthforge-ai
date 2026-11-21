(()=>{'use strict';
  // Business membership (Ironcrest Workforce Operations). All pricing, eligibility and
  // access decisions are made by the Business API; this script only displays them.
  // Until that API reports checkout open, the page keeps its "Coming Soon" wording.
  const API='https://profitharbor-business-api.bluemagic920.workers.dev';
  const $=id=>document.getElementById(id);
  const panel=$('phBusinessPanel'),status=$('phBusinessStatus'),form=$('phBusinessForm'),company=$('phBusinessCompany'),
    companyRow=$('phBusinessCompanyRow'),buy=$('phBusinessBuy'),actions=$('phBusinessActions'),open=$('phBusinessOpen'),manage=$('phBusinessManage');
  if(!panel||!status||!form||!company||!companyRow||!buy||!actions||!open||!manage)return;
  let seq=0,state=null,stateToken=null,busy=false,launched=false,notice='',authSubscribed=false;
  window.phVerifiedBusiness=false;
  const money=cents=>'$'+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const day=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}):'';};

  // Replace "Coming Soon" wording with launch wording, once, and enable the plan buttons.
  function launch(){
    if(launched)return;launched=true;
    document.querySelectorAll('[data-business-open]').forEach(el=>{
      const text=el.getAttribute('data-business-open');
      el.textContent=text;if(!text)el.hidden=true;
      if(el.hasAttribute('data-business-action')){el.disabled=false;el.removeAttribute('aria-disabled');}
    });
  }
  async function sessionToken(){
    const sb=window.wealthforgeAuthClient;
    if(!sb?.auth?.getSession)return null;
    try{const {data,error}=await sb.auth.getSession();return error?null:(data?.session?.access_token||null);}catch{return null;}
  }
  async function call(path,method,token,body){
    const response=await fetch(API+path,{method,cache:'no-store',credentials:'omit',
      headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let result={};try{result=await response.json();}catch{}
    return {ok:response.ok,status:response.status,result};
  }
  function render(){
    window.phVerifiedBusiness=Boolean(state?.active&&state.mode==='live')||Boolean(state?.lifetime);
    form.hidden=true;actions.hidden=true;open.hidden=true;manage.hidden=true;
    if(!state){panel.hidden=true;return;}
    const test=state.mode==='test'?'TEST MODE — no real payment is taken and the live workspace is not unlocked. ':'';
    const prices=money(state.prices.month)+' a month or '+money(state.prices.year)+' a year';
    let text='',show=true;
    if(state.lifetime){text='Lifetime Business membership is active. No subscription is required.';actions.hidden=false;open.hidden=false;}
    else if(state.active){
      const end=day(state.currentPeriodEnd);
      text='Your Business membership is active'+(end?(state.cancelAtPeriodEnd?' until '+end+', then it ends.':'. Next renewal: '+end+'.'):'.');
      actions.hidden=false;open.hidden=!state.workspaceAccess;manage.hidden=!state.canManageBilling;
    }
    else if(state.reviewRequired)text='Billing for this account needs review. Please contact support.';
    else if(['past_due','unpaid','incomplete','paused','trialing'].includes(state.subscriptionStatus)){text='Your Business subscription needs attention ('+state.subscriptionStatus.replace('_',' ')+'). Open Manage Business billing to update your payment method.';actions.hidden=false;manage.hidden=!state.canManageBilling;}
    else if(state.subscriptionStatus!=='none')text='Your Business subscription has ended. Please contact support to reactivate it.';
    else if(!state.eligible)text='This account already belongs to a company as a team member. Use a separate account to buy Business.';
    else if(state.checkoutOpen){
      text='Business is '+prices+'. It includes everything in Pro plus Ironcrest Workforce Operations for up to '+state.employeesIncluded+' employees.';
      form.hidden=false;companyRow.hidden=state.hasCompany;
      $('phBusinessMonthLabel').textContent='Monthly — '+money(state.prices.month);$('phBusinessYearLabel').textContent='Annual — '+money(state.prices.year);
    }
    else show=false;
    panel.hidden=!show;status.textContent=test+(notice?notice+' ':'')+text;
  }
  async function check(){
    const auth=window.wealthforgeAuthClient?.auth;
    if(!authSubscribed&&auth?.onAuthStateChange){authSubscribed=true;auth.onAuthStateChange(()=>{
      ++seq;state=null;stateToken=null;window.phVerifiedBusiness=false;render();setTimeout(check,0);
    });}
    const current=++seq,token=await sessionToken();
    try{
      if(!token){
        // Signed out: only learn whether live checkout is open, to choose the public wording.
        const health=await call('/health','GET');
        if(current!==seq)return;
        if(health.ok&&health.result.configured===true&&health.result.checkoutOpen===true&&health.result.mode==='live')launch();
        state=null;render();return;
      }
      const r=await call('/api/business/status','GET',token);
      if(current!==seq||token!==await sessionToken())return;
      if(!r.ok||r.result.available!==true||!r.result.prices){state=null;render();return;}
      state=r.result;stateToken=token;
      if(!busy){buy.disabled=false;manage.disabled=false;}
      if(state.mode==='live'&&(state.checkoutOpen||state.active)||state.lifetime)launch();
      render();
    }catch{if(current===seq){state=null;render();}}
  }
  async function redirect(path,body,host){
    if(busy||!stateToken)return;const renderedToken=stateToken,current=seq;busy=true;buy.disabled=true;manage.disabled=true;notice='';
    status.textContent='Preparing secure Stripe billing…';
    try{
      const token=await sessionToken();if(!token)throw Error('Sign in under Account first.');
      if(token!==renderedToken||current!==seq)throw Error('Your account changed. Refresh billing status before continuing.');
      const r=await call(path,'POST',token,body);
      if(token!==await sessionToken()||current!==seq)throw Error('Your account changed. Refresh billing status before continuing.');
      if(!r.ok||typeof r.result.url!=='string')throw Error(r.result.error||'Billing is unavailable right now. Refresh billing status before trying again.');
      const destination=new URL(r.result.url);
      if(destination.protocol!=='https:'||destination.hostname!==host||destination.username||destination.password||destination.port)throw Error('Unexpected billing destination.');
      window.location.assign(destination.href);
    }catch(e){status.textContent=e?.message||'Billing is unavailable right now. Refresh billing status before trying again.';}
    finally{busy=false;/* A fresh status check is required before another attempt. */}
  }
  form.addEventListener('submit',event=>{
    event.preventDefault?.();
    if(!state?.checkoutOpen||buy.disabled)return;
    const name=company.value.trim();
    if(!state.hasCompany&&(name.length<1||name.length>120)){status.textContent='Enter your company name (up to 120 characters).';company.focus();return;}
    const interval=document.querySelector('input[name="phBusinessInterval"]:checked')?.value==='year'?'year':'month';
    redirect('/api/business/checkout',{interval,...(state.hasCompany?{}:{companyName:name})},'checkout.stripe.com');
  });
  manage.addEventListener('click',()=>{if(!manage.disabled)redirect('/api/business/portal',{},'billing.stripe.com');});
  const showAccount=()=>{document.querySelector('[data-ph-target="cloud"]')?.click();};
  document.querySelectorAll('[data-business-action]').forEach(button=>button.addEventListener('click',()=>{
    if(button.disabled)return;
    if(button.getAttribute('data-business-action')==='account')showAccount();
    setTimeout(()=>{check().then(()=>{if(!panel.hidden){panel.scrollIntoView?.({behavior:'smooth',block:'center'});if(!form.hidden&&!companyRow.hidden)company.focus();}
      else{const s=$('phProStatus');if(s&&!state)s.textContent='Sign in under Account to choose Business.';}});},0);
  }));
  document.querySelector('[data-tab="cloud"]')?.addEventListener('click',check);
  document.querySelector('[data-ph-target="cloud"]')?.addEventListener('click',()=>setTimeout(check,0));
  window.addEventListener('focus',()=>{if(!$('cloud')?.classList.contains('hidden'))check();});

  // Returning from Stripe Checkout: access is granted by the billing webhook, so poll briefly.
  const outcome=new URLSearchParams(window.location.search).get('business');
  if(outcome==='success'||outcome==='cancelled'){
    try{const url=new URL(window.location.href);url.searchParams.delete('business');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}catch{}
    setTimeout(async()=>{
      showAccount();
      if(outcome==='cancelled'){notice='Checkout closed. Checking billing status.';await check();notice='';return;}
      for(let attempt=0;attempt<12;attempt++){
        notice='Confirming billing status…';await check();
        if(state?.active||!state){break;}
        await new Promise(resolve=>setTimeout(resolve,5000));
      }
      notice=state&&!state.active?'Billing has not confirmed an active membership yet. Refresh this page in a minute.':'';render();notice='';
    },1500);
  }else setTimeout(check,1300);
})();
