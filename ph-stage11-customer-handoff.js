/* Stage 11: owner-only REAL lead review and explicit CRM import. No public collection. */
(()=>{'use strict';
const section=document.getElementById('leads');if(!section)return;
const api='https://profitharbor-leads-staging.bluemagic920.workers.dev';
const panel=document.createElement('div');panel.className='panel';panel.id='phRealLeadHandoff';
panel.innerHTML='<h3>Real lead inbox · Staging</h3><p class="note">View owner-scoped real leads. Import to Customers only after reviewing them. Public collection is still disabled.</p><div class="ph-lead-actions"><label>Campaign <select id="phRealCampaign"><option value="">Choose campaign</option></select></label><button type="button" id="phRealRefresh">Load real leads</button><button type="button" id="phRealImport" disabled>Import reviewed leads into Customers</button></div><p id="phRealStatus" class="note" role="status">Sign in to load your real lead inbox.</p><div id="phRealList"></div>';
const report=document.getElementById('phStage8Report');if(report)report.insertAdjacentElement('beforebegin',panel);else section.append(panel);
const $=id=>document.getElementById(id), sel=$('phRealCampaign'),stat=$('phRealStatus'),list=$('phRealList'),imp=$('phRealImport');
let rows=[],owner=null,busy=false;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function auth(){const c=window.wealthforgeAuthClient;if(!c)throw Error('Sign in first.');const {data,error}=await c.auth.getSession();if(error||!data?.session?.access_token||!data.session.user?.id)throw Error('Sign in first.');return {token:data.session.access_token,id:data.session.user.id};}
async function req(path,token){const r=await fetch(api+path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});let j;try{j=await r.json()}catch{throw Error('Invalid API response.')}if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j;}
function clear(){rows=[];owner=null;list.replaceChildren();imp.disabled=true;}
async function campaigns(){const a=await auth(),j=await req('/api/leads/campaigns',a.token);const prev=sel.value;sel.replaceChildren(new Option('Choose campaign',''));for(const c of j.campaigns||[])if(uuid.test(c.id))sel.add(new Option(c.name||'Campaign',c.id));if([...sel.options].some(o=>o.value===prev))sel.value=prev;}
async function load(){if(busy)return;busy=true;clear();stat.textContent='Loading real leads…';try{await campaigns();if(!uuid.test(sel.value))throw Error('Choose a campaign.');const a=await auth(),j=await req('/api/leads/real-report?campaign_id='+encodeURIComponent(sel.value),a.token);if(j.staging_only!==true||j.campaign?.id!==sel.value||!Array.isArray(j.leads))throw Error('Unexpected report; no leads imported.');rows=j.leads;owner=a.id;for(const l of rows){const p=document.createElement('p');p.textContent=[l.full_name,l.email,l.source,l.created_at].filter(Boolean).join(' · ');list.append(p);}stat.textContent=rows.length+' real lead(s) found. '+(rows.length?'Review before importing.':'No imports needed.');imp.disabled=!rows.length;}catch(e){stat.textContent=e.message;}finally{busy=false;}}
$('phRealRefresh').addEventListener('click',load);
sel.addEventListener('change',()=>{clear();stat.textContent='Click Load real leads.';});
imp.addEventListener('click',async()=>{if(busy||!rows.length||!owner)return;busy=true;imp.disabled=true;try{const a=await auth();if(a.id!==owner)throw Error('Account changed. Reload the report.');if(!window.phImportVerifiedRealLeads)throw Error('Customer importer unavailable.');if(!window.phCloudSyncReady?.())throw Error('Cloud sync is not ready.');if(!confirm('Import '+rows.length+' reviewed lead(s) into your Customers list? Existing matching emails and lead IDs will be skipped.'))return;const result=window.phImportVerifiedRealLeads(rows,owner);stat.textContent='Added '+result.added+' customer(s); skipped '+result.skipped+' duplicate(s). Cloud sync will save the changes.';}catch(e){stat.textContent='Import stopped: '+e.message;}finally{busy=false;imp.disabled=!rows.length;}});
async function refreshInboxCampaigns(){
 if(document.hidden||busy)return;
 try{await campaigns();}catch(e){stat.textContent=e.message;}
}
document.querySelector('[data-tab="leads"]')?.addEventListener('click',refreshInboxCampaigns);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshInboxCampaigns()});
setInterval(refreshInboxCampaigns,60000);
window.addEventListener('load',()=>setTimeout(refreshInboxCampaigns,1500));
})();
