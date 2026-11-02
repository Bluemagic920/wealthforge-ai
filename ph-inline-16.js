(()=>{'use strict';
const API='https://profitharbor-leads-api.bluemagic920.workers.dev/api/leads/campaigns';
const el=id=>document.getElementById(id);let step=1,busy=false;
const panels=[...document.querySelectorAll('[data-lead-panel]')];
const sourceMap={facebook:'facebook',instagram:'instagram',google:'google',tv:'tv',radio:'radio',referral:'referral','flyer / qr code':'qr',other:'other'};
function source(){return el('phLeadSource').value.trim().toLowerCase()}
function status(t){el('phLeadStatus').textContent=t}
function render(){panels.forEach(p=>p.hidden=Number(p.dataset.leadPanel)!==step);document.querySelectorAll('[data-lead-step-label]').forEach(p=>p.classList.toggle('current',Number(p.dataset.leadStepLabel)===step));el('phLeadBack').disabled=busy||step===1;el('phLeadNext').disabled=busy;el('phLeadNext').textContent=busy?'Saving…':step===3?'Save Campaign':'Continue';if(!busy)status(step===1?'Step 1 of 3 · Choose your lead source.':step===2?'Step 2 of 3 · Enter campaign details.':'Step 3 of 3 · Review and save a private draft.');if(step===3){const rows=[['Business',el('phLeadIndustry').selectedOptions[0].textContent],['Source',el('phLeadSource').value],['Campaign',el('phLeadCampaign').value.trim()],['Goal',el('phLeadGoal').value]];el('phLeadReview').replaceChildren();for(const [label,value] of rows){const p=document.createElement('p'),b=document.createElement('strong');b.textContent=label+': ';p.append(b,document.createTextNode(value));el('phLeadReview').append(p)}}}
async function token(){const client=window.wealthforgeAuthClient;if(!client?.auth?.getSession)throw Error('Sign in to ProfitHarbor AI before using campaign drafts.');const {data,error}=await client.auth.getSession();if(error||!data?.session?.access_token)throw Error('Sign in to ProfitHarbor AI before using campaign drafts.');return data.session.access_token}
async function request(method,body){const t=await token();const r=await fetch(API,{method,headers:{Authorization:'Bearer '+t,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.error||'Campaign service unavailable ('+r.status+').');return j}
async function updateCampaign(id,payload){
 const t=await token();const r=await fetch(API+'/'+encodeURIComponent(id),{method:'PATCH',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Campaign update failed ('+r.status+').');return j;
}
async function refresh(){
 const list=el('phLeadCampaignList'),note=el('phLeadListStatus');note.textContent='Loading campaigns…';
 try{
  const j=await request('GET');list.replaceChildren();const rows=j.campaigns||[];
  note.textContent=rows.length?rows.length+' saved campaign(s). Campaign statuses are internal; no ads or public tracking are enabled.':'No saved campaigns yet.';
  for(const c of rows){
   const item=document.createElement('div');item.className='ph-campaign-item';
   const info=document.createElement('div');info.className='ph-campaign-info';
   const name=document.createElement('strong');name.textContent=c.name||'Unnamed campaign';
   const details=document.createElement('small');details.className='muted';details.textContent=' · '+(c.source||'other')+' · '+(c.status||'draft');info.append(name,details);
   item.append(info);
   if(c.status!=='archived'){
    const select=document.createElement('select');select.className='ph-campaign-select';select.setAttribute('aria-label','Manage '+(c.name||'campaign'));
    for(const [value,label] of [['','Manage campaign'],['rename','Rename'],[c.status==='paused'?'resume':'pause',c.status==='paused'?'Resume to draft':'Pause'],['archive','Archive']]){
     const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
    }
    select.addEventListener('change',async()=>{
     const action=select.value;select.value='';if(!action)return;
     let payload={action};
     if(action==='rename'){
      const value=window.prompt('New campaign name:',c.name||'');if(value===null)return;
      const name=value.trim();if(!name||name.length>120){note.textContent='Enter a name between 1 and 120 characters.';return}payload.name=name;
     }
     if(action==='archive'&&!window.confirm('Archive "'+c.name+'"? Archived campaigns cannot be edited or resumed.'))return;
     if(action==='pause'&&!window.confirm('Pause "'+c.name+'"? This changes only its internal status, not external ads.'))return;
     if(action==='resume'&&!window.confirm('Resume "'+c.name+'" as a private draft? No ads or tracking will activate.'))return;
     select.disabled=true;note.textContent='Updating campaign…';
     try{await updateCampaign(c.id,payload);await refresh();note.textContent='Campaign updated successfully. Public tracking remains disabled.'}
     catch(e){note.textContent='Update failed: '+e.message;select.disabled=false}
    });
    item.append(select);
   }
   list.append(item);
  }
 }catch(e){list.replaceChildren();note.textContent=e.message}
}
// Automatically refresh on startup and whenever authentication or tab visibility changes.
// Do not rely on a one-time session check: cloud.js restores auth asynchronously.
let refreshInFlight=false, refreshQueued=false, lastUser=null;
const performRefresh=refresh;
refresh=async function(){
 if(refreshInFlight){refreshQueued=true;return}
 refreshInFlight=true;
 try{await performRefresh()}finally{
  refreshInFlight=false;
  if(refreshQueued){refreshQueued=false;setTimeout(refresh,0)}
 }
};
async function refreshIfSignedIn(){
 const client=window.wealthforgeAuthClient;
 if(!client?.auth?.getSession)return false;
 try{
  const {data,error}=await client.auth.getSession();
  if(error||!data?.session?.access_token)return false;
  lastUser=data.session.user?.id||null;
  await refresh();return true;
 }catch(e){el('phLeadListStatus').textContent='Campaign refresh: '+e.message;return false}
}
// Retry early while cloud.js initializes; also retry after page/tab return.
[0,400,1200,3000,6500].forEach(ms=>setTimeout(refreshIfSignedIn,ms));
setInterval(()=>{if(document.visibilityState==='visible')refreshIfSignedIn()},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshIfSignedIn()});
window.addEventListener('focus',refreshIfSignedIn);
document.querySelectorAll('[data-tab]').forEach(button=>{
 if(/lead/i.test(button.dataset.tab||''))
  button.addEventListener('click',refreshIfSignedIn);
});
// Attach to the already-created Supabase client, and retry if it is not ready.
function bindAuthEvents(){
 const client=window.wealthforgeAuthClient;
 if(!client?.auth?.onAuthStateChange){setTimeout(bindAuthEvents,500);return}
 client.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'){
   lastUser=null;el('phLeadCampaignList').replaceChildren();
   el('phLeadListStatus').textContent='Sign in to view saved campaign drafts.';
  }else if(session?.access_token&&['SIGNED_IN','TOKEN_REFRESHED','INITIAL_SESSION'].includes(event)){
   setTimeout(refreshIfSignedIn,0);
  }
 });
}
bindAuthEvents();
el('phLeadRefresh')?.addEventListener('click',refresh);
el('phLeadBack').addEventListener('click',()=>{if(step>1&&!busy){step--;render()}});
el('phLeadNext').addEventListener('click',async()=>{if(busy)return;if(step===1&&!source()){status('Choose a lead source before continuing.');return}if(step===2&&!el('phLeadCampaign').value.trim()){status('Enter a campaign name before continuing.');el('phLeadCampaign').focus();return}if(step<3){step++;render();return}if(!sourceMap[source()]){status('This source cannot be saved to the campaign service yet. Select a supported source, then try again.');return}busy=true;render();try{const j=await request('POST',{name:el('phLeadCampaign').value.trim(),source:sourceMap[source()]});step=1;busy=false;render();status('Saved: '+j.campaign.name+' (draft). No tracking or collection is enabled.');await refresh()}catch(e){busy=false;render();status('Campaign not saved: '+e.message)}});
render();
})();