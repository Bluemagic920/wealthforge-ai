/* Stage 11: owner-only REAL lead review and explicit CRM import. No public collection. */
(()=>{'use strict';
const section=document.getElementById('leads');if(!section)return;
const api='https://profitharbor-leads-api.bluemagic920.workers.dev';
const panel=document.createElement('div');panel.className='panel';panel.id='phRealLeadHandoff';
panel.innerHTML='<h3>Real lead inbox · Production</h3><p class="note">View owner-scoped real leads. Import to Customers only after reviewing them. Public collection is enabled. Review incoming leads before importing them into Customers.</p><div class="ph-lead-actions"><label>Campaign <select id="phRealCampaign"><option value="">Choose campaign</option></select></label><button type="button" id="phRealRefresh">Load real leads</button><button type="button" id="phRealImport" disabled>Import reviewed leads into Customers</button></div><p id="phRealStatus" class="note" role="status">Loading your account…</p><div id="phRealList"></div>';
// Stage 16: opt-in automatic import while this authenticated browser tab is open.
// Server-side background import is NOT enabled. Synthetic records are always excluded.
const controls=document.createElement('div');controls.id='phStage16Controls';
controls.innerHTML='<h4>Automatic customer handoff · Not yet enabled</h4><div id="phStage16AutoRow"><input id="phStage16Auto" type="checkbox" aria-label="Automatically import eligible leads"><label for="phStage16Auto">Automatically import eligible leads while this tab is open</label></div><p id="phStage16Status" class="note" role="status">Disabled during production verification. Review and import leads manually.</p>';
panel.append(controls);
// Isolate the opt-in control from site-wide label/checkbox layout rules.
const autoRow=controls.querySelector('#phStage16AutoRow');
Object.assign(autoRow.style,{display:'flex',alignItems:'center',justifyContent:'flex-start',gap:'12px',width:'100%',flexWrap:'nowrap'});
const autoLabel=autoRow.querySelector('label');
Object.assign(autoLabel.style,{display:'inline',position:'static',width:'auto',maxWidth:'none',margin:'0',padding:'0',flex:'1 1 auto',textAlign:'left'});
const autoInput=controls.querySelector('#phStage16Auto');
Object.assign(autoInput.style,{appearance:'auto',position:'static',display:'block',float:'none',transform:'none',flex:'0 0 18px',width:'18px',height:'18px',margin:'0',padding:'0',minWidth:'18px',maxWidth:'18px'});
const autoBox=controls.querySelector('#phStage16Auto'),autoStatus=controls.querySelector('#phStage16Status');
 autoBox.checked=false;autoBox.disabled=true;
const isSynthetic=l=>/\bstaging\s*test\b|do not contact|synthetic/i.test(String(l.full_name||''))||/@example\.invalid$/i.test(String(l.email||'').trim());
let autoWorking=false;
const report=document.getElementById('phStage8Report');if(report)report.insertAdjacentElement('beforebegin',panel);else section.append(panel);
const $=id=>document.getElementById(id), sel=$('phRealCampaign'),stat=$('phRealStatus'),list=$('phRealList'),imp=$('phRealImport');
let rows=[],owner=null,busy=false,importMessage=false;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function auth(){const c=window.wealthforgeAuthClient;if(!c)throw Error('Authentication is still loading.');const {data,error}=await c.auth.getSession();if(error)throw Error(error.message||'Authentication check failed.');if(!data?.session?.access_token||!data.session.user?.id)throw Error('Sign in first.');return {token:data.session.access_token,id:data.session.user.id};}
async function req(path,token){const r=await fetch(api+path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});let j;try{j=await r.json()}catch{throw Error('Invalid API response.')}if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j;}
function clear(){rows=[];owner=null;list.replaceChildren();imp.disabled=true;}
async function campaigns(){const a=await auth(),j=await req('/api/leads/campaigns',a.token);const prev=sel.value;sel.replaceChildren(new Option('Choose campaign',''));for(const c of j.campaigns||[])if(uuid.test(c.id))sel.add(new Option(c.name||'Campaign',c.id));if([...sel.options].some(o=>o.value===prev))sel.value=prev;}
async function load(){if(busy)return;busy=true;importMessage=false;clear();stat.textContent='Loading real leads…';try{await campaigns();if(!uuid.test(sel.value))throw Error('Choose a campaign.');const a=await auth(),j=await req('/api/leads/real-report?campaign_id='+encodeURIComponent(sel.value),a.token);if(j.staging_only===true||j.campaign?.id!==sel.value||!Array.isArray(j.leads)||j.leads.length>100)throw Error('Unexpected report; no leads imported.');rows=j.leads;owner=a.id;for(const l of rows){const p=document.createElement('p');p.textContent=[l.full_name,l.email,l.source,l.created_at].filter(Boolean).join(' · ');list.append(p);}stat.textContent=rows.length+' real lead(s) found. '+(rows.length?'Review before importing.':'No imports needed.');imp.disabled=!rows.length;}catch(e){stat.textContent=e.message;}finally{busy=false;}}
$('phRealRefresh').addEventListener('click',load);
sel.addEventListener('change',()=>{importMessage=false;clear();stat.textContent='Click Load real leads.';});
imp.addEventListener('click',async()=>{if(busy||!rows.length||!owner)return;busy=true;imp.disabled=true;try{const a=await auth();if(a.id!==owner)throw Error('Account changed. Reload the report.');if(!window.phImportVerifiedRealLeads)throw Error('Customer importer unavailable.');if(typeof window.phCloudSyncReady!=='function')throw Error('Cloud sync readiness function is unavailable.');if(window.phCloudSyncReady()!==true)throw Error('Cloud sync is not ready. No customer was created. Check the dashboard sync status.');if(!confirm('Import '+rows.length+' reviewed lead(s) into your Customers list? Existing matching emails and lead IDs will be skipped.'))return;const eligible=rows.filter(l=>!isSynthetic(l));if(!eligible.length)throw Error('Only synthetic test records found; nothing to import.');const result=window.phImportVerifiedRealLeads(eligible,owner);importMessage=true;stat.textContent='Added '+result.added+' customer(s); skipped '+result.skipped+' duplicate(s). Cloud sync will save the changes.';}catch(e){importMessage=true;stat.textContent='Import stopped: '+e.message;}finally{busy=false;imp.disabled=!rows.length;}});
async function autoImport(){
 if(true||!autoBox.checked||autoWorking||busy||document.hidden||!uuid.test(sel.value))return;
 autoWorking=true;
 try{
  const a=await auth();
  if(!window.phCloudSyncReady?.())throw Error('Cloud sync not ready; no import performed.');
  const j=await req('/api/leads/real-report?campaign_id='+encodeURIComponent(sel.value),a.token);
  if(j.staging_only===true||j.campaign?.id!==sel.value||!Array.isArray(j.leads)||j.leads.length>100)throw Error('Invalid production report.');
  const eligible=j.leads.filter(l=>!isSynthetic(l));
  if(!eligible.length){autoStatus.textContent='No eligible leads. Synthetic records excluded.';return;}
  if(eligible.length>100)throw Error('More than 100 leads; automatic import paused for review.');
  if(!window.phImportVerifiedRealLeads)throw Error('Customer importer unavailable.');
  const current=await auth();if(current.id!==a.id)throw Error('Account changed.');
  const result=window.phImportVerifiedRealLeads(eligible,a.id);
  autoStatus.textContent='Imported '+result.added+' new customer(s); skipped '+result.skipped+' duplicate(s). Cloud sync pending.';
 }catch(e){autoStatus.textContent='Automatic import paused: '+e.message;autoBox.checked=false;}
 finally{autoWorking=false;}
}
autoBox.addEventListener('change',()=>{
 if(autoBox.checked){if(!uuid.test(sel.value)){autoBox.checked=false;autoStatus.textContent='Select a campaign first.';return;}
  if(!confirm('Enable automatic imports for this campaign while this browser tab is open? Only eligible leads will be imported; synthetic test records are excluded.')){autoBox.checked=false;return;}
  autoStatus.textContent='Enabled for this tab and selected campaign.';autoImport();
 }else autoStatus.textContent='Automatic import OFF.';
});
sel.addEventListener('change',()=>{autoBox.checked=false;autoStatus.textContent='Campaign changed; automatic import OFF.';});
// Automatic imports intentionally disabled for production launch review.
async function refreshInboxCampaigns(){
 if(document.hidden||busy||importMessage)return;
 stat.textContent='Refreshing campaigns…';
 try{
  await campaigns();
  if(!rows.length)stat.textContent=uuid.test(sel.value)?'Campaign selected. Click Load real leads.':'Choose a campaign to load your real lead inbox.';
  else stat.textContent=rows.length+' real lead(s) loaded. Review before importing.';
 }catch(e){
  // Only confirmed authentication failures should show a sign-in instruction.
  stat.textContent=/sign in first|invalid jwt|session expired|not authenticated/i.test(String(e.message))
   ?'Sign in to load your real lead inbox.'
   :'Unable to refresh campaigns: '+e.message;
 }
}
document.querySelector('[data-tab="leads"]')?.addEventListener('click',refreshInboxCampaigns);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshInboxCampaigns()});
// Campaigns refresh on opening the tab or returning to the page; no background polling.
window.addEventListener('load',()=>setTimeout(refreshInboxCampaigns,1500));
})();
