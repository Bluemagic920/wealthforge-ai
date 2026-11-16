(()=>{'use strict';
const API='https://profitharbor-leads-api.bluemagic920.workers.dev/api/leads/campaigns';
const el=id=>document.getElementById(id);let step=1,busy=false;
const panels=[...document.querySelectorAll('[data-lead-panel]')];
const sourceMap={facebook:'facebook',instagram:'instagram',google:'google',tv:'tv',radio:'radio',referral:'referral','flyer / qr code':'qr',other:'other'};
function source(){return el('phLeadSource').value.trim().toLowerCase()}
function status(t){el('phLeadStatus').textContent=t}
function render(){panels.forEach(p=>p.hidden=Number(p.dataset.leadPanel)!==step);document.querySelectorAll('[data-lead-step-label]').forEach(p=>p.classList.toggle('current',Number(p.dataset.leadStepLabel)===step));el('phLeadBack').disabled=busy||step===1;el('phLeadNext').disabled=busy;el('phLeadNext').textContent=busy?'Saving…':step===3?'Save Campaign':'Continue';if(!busy)status(step===1?'Step 1 of 3 · Choose your lead source.':step===2?'Step 2 of 3 · Enter campaign details.':'Step 3 of 3 · Review and save a private draft.');if(step===3){const rows=[['Business',el('phLeadIndustry').selectedOptions[0].textContent],['Source',el('phLeadSource').value],['Campaign',el('phLeadCampaign').value.trim()],['Goal',el('phLeadGoal').value]];el('phLeadReview').replaceChildren();for(const [label,value] of rows){const p=document.createElement('p'),b=document.createElement('strong');b.textContent=label+': ';p.append(b,document.createTextNode(value));el('phLeadReview').append(p)}}}
const service=window.phLeadApi;
let loading=0;
async function request(method,body,context){return service.request('/api/leads/campaigns',{method,body,context});}
async function updateCampaign(id,payload,context){return service.request('/api/leads/campaigns/'+encodeURIComponent(id),{method:'PATCH',body:payload,context});}
document.addEventListener('ph:leads-account-changed',()=>{loading++;el('phLeadCampaignList').replaceChildren();el('phLeadListStatus').textContent='Account changed. Refresh campaigns.';setTimeout(refresh,0);});
async function refresh(){
 const list=el('phLeadCampaignList'),note=el('phLeadListStatus');note.textContent='Loading campaigns…';let generation=loading;
 try{
  const context=await service.capture();generation=++loading;const [j,capabilities]=await Promise.all([request('GET',undefined,context),service.request('/api/leads/capabilities',{context})]);if(generation!==loading)return;list.replaceChildren();const rows=j.campaigns||[];
  note.textContent=rows.length?rows.length+' saved campaign(s). Activation prepares tracking links; public collection requires separate approval.':'No saved campaigns yet.';
  for(const c of rows){
   const item=document.createElement('div');item.className='ph-campaign-item';
   const info=document.createElement('div');info.className='ph-campaign-info';
   const name=document.createElement('strong');name.textContent=c.name||'Unnamed campaign';
   const details=document.createElement('small');details.className='muted';details.textContent=' · '+(c.source||'other')+' · '+(c.status||'draft');info.append(name,details);
   item.append(info);
   if(c.status!=='archived'){
    const select=document.createElement('select');select.className='ph-campaign-select';select.setAttribute('aria-label','Manage '+(c.name||'campaign'));
    for(const [value,label] of [['','Manage campaign'],['rename','Rename'],...(['draft','paused'].includes(c.status)?[['activate',capabilities.campaign_activation_enabled?'Activate for tracking':'Activation awaiting approval']]:[]),[c.status==='paused'?'resume':'pause',c.status==='paused'?'Resume to draft':'Pause'],['archive','Archive']]){
     const option=document.createElement('option');option.value=value;option.textContent=label;if(value==='activate'&&!capabilities.campaign_activation_enabled)option.disabled=true;select.append(option);
    }
    select.addEventListener('change',async()=>{
     const action=select.value;select.value='';if(!action)return;
     let payload={action};if(action==='activate'){if(!window.confirm('Activate '+c.name+' for tracking-link setup? This does not publish ads or approve public lead collection.'))return;payload.expected_updated_at=c.updated_at;}
     if(action==='rename'){
      const value=window.prompt('New campaign name:',c.name||'');if(value===null)return;
      const name=value.trim();if(!name||name.length>120){note.textContent='Enter a name between 1 and 120 characters.';return}payload.name=name;
     }
     if(action==='archive'&&!window.confirm('Archive "'+c.name+'"? Archived campaigns cannot be edited or resumed.'))return;
     if(action==='pause'&&!window.confirm('Pause "'+c.name+'"? This changes only its internal status, not external ads.'))return;
     if(action==='resume'&&!window.confirm('Resume "'+c.name+'" as a private draft? No ads or tracking will activate.'))return;
     select.disabled=true;note.textContent='Updating campaign…';
     try{await service.current(context);const result=await updateCampaign(c.id,payload,context);if(result.campaign?.id!==c.id||(action==='activate'&&result.campaign.status!=='active'))throw Error('Update receipt could not be verified.');await refresh();note.textContent=action==='activate'?'Campaign activated. Choose it in Campaign tracking links below. Public collection requires approval.':'Campaign updated.';document.dispatchEvent(new CustomEvent('ph:campaigns-updated',{detail:{campaignId:c.id}}));}
     catch(e){note.textContent='Update not confirmed: '+e.message+' Refresh campaigns before trying again.';}
    });
    item.append(select);
   }
   list.append(item);
  }
 }catch(e){if(generation!==loading)return;listContext=null;list.replaceChildren();note.textContent=e.message}
}
// Preserve asynchronous sign-in restoration and refresh when returning to Leads.
setTimeout(refresh,0);
setInterval(()=>{if(!document.hidden)refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('focus',refresh);
document.querySelectorAll('[data-tab]').forEach(button=>{if(/lead/i.test(button.dataset.tab||''))button.addEventListener('click',refresh);});
el('phLeadRefresh')?.addEventListener('click',refresh);
el('phLeadBack').addEventListener('click',()=>{if(step>1&&!busy){step--;render()}});
el('phLeadNext').addEventListener('click',async()=>{if(busy)return;if(step===1&&!source()){status('Choose a lead source before continuing.');return}if(step===2&&!el('phLeadCampaign').value.trim()){status('Enter a campaign name before continuing.');el('phLeadCampaign').focus();return}if(step<3){step++;render();return}if(!sourceMap[source()]){status('This source cannot be saved to the campaign service yet. Select a supported source, then try again.');return}busy=true;render();try{const j=await request('POST',{name:el('phLeadCampaign').value.trim(),source:sourceMap[source()]});step=1;busy=false;render();status('Saved: '+j.campaign.name+' (draft). No tracking or collection is enabled.');await refresh()}catch(e){busy=false;render();status('Campaign not saved: '+e.message)}});
render();
})();