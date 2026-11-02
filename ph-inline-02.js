
(()=>{'use strict';const KEY=localStorage.getItem('wealthforge_active_user')?'wealthforge_user_'+localStorage.getItem('wealthforge_active_user'):'wealthforge_v1_local';const empty=()=>({customers:[],drafts:[],workflows:[],assets:[],goals:[],cash:[]});let data;try{data=JSON.parse(localStorage.getItem(KEY))||empty()}catch{data=empty()}if(!Array.isArray(data.customers)||!Array.isArray(data.drafts)||!Array.isArray(data.workflows))data=empty();for(const k of ['assets','goals','cash'])if(!Array.isArray(data[k]))data[k]=[];const $=id=>document.getElementById(id);window.phGetCurrentCustomers=()=>Array.isArray(data.customers)?data.customers.map(c=>({...c})):[];const save=()=>{localStorage.setItem(KEY,JSON.stringify(data));render();window.dispatchEvent(new CustomEvent('wealthforge:changed'))};const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('main>section').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab))}));let editingCustomerId=null;
function resetCustomerEditor(){
 editingCustomerId=null;$('customerForm').reset();
 $('customerFormHeading').textContent='Add customer';$('customerSaveButton').textContent='Save customer';
 $('customerCancelEdit').hidden=true;$('customerEditNotice').hidden=true;
}
$('customerCancelEdit').onclick=resetCustomerEditor;
$('customerForm').addEventListener('submit',e=>{
 e.preventDefault();const f=new FormData(e.target);
 const fields={name:String(f.get('name')||'').trim(),email:String(f.get('email')||'').trim(),business:String(f.get('business')||'').trim(),value:Math.max(0,Number(f.get('value'))||0),status:String(f.get('status')||'Lead')};
 if(!fields.name)return alert('Enter a customer name.');
 if(editingCustomerId){
  const existing=data.customers.find(c=>c.id===editingCustomerId);
  if(!existing){resetCustomerEditor();return alert('Customer no longer exists.')}
  Object.assign(existing,fields);
 }else {
  if(data.customers.length>=5 && window.phVerifiedPro!==true){
    const msg='Free accounts can save up to 5 customers. Upgrade to Pro for unlimited customers.';
    const n=document.getElementById('phCustomerLimitMessage');if(n)n.textContent=msg;
    alert(msg);return;
  }
  data.customers.push({id:crypto.randomUUID(),...fields});
 }
 resetCustomerEditor();save();
});
function renderCustomerDirectory(){
 const q=($('phCustomerSearch')?.value||'').trim().toLocaleLowerCase();
 const filtered=data.customers.filter(c=>[c.name,c.business,c.email,c.phone].some(v=>String(v||'').toLocaleLowerCase().includes(q)));
 $('phCustomerSearchCount').textContent=q?`${filtered.length} of ${data.customers.length} customers found`:`${data.customers.length} customers`;
 $('customerRows').innerHTML=filtered.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.business)}</td><td>${esc(c.status)}</td><td>${money(c.value)}</td><td><button data-email="${esc(c.id)}" ${c.email?'':'disabled title="Add a customer email first"'}>Email</button> <button data-edit="${esc(c.id)}">Edit</button> <button data-remove="${esc(c.id)}">Delete</button></td></tr>`).join('')||`<tr><td colspan="6">${q?'No customers match your search.':'No customers yet.'}</td></tr>`;
}
$('phCustomerSearch').addEventListener('input',renderCustomerDirectory);
$('phEmailClose').onclick=()=>$('phEmailDialog').close();
$('phEmailCopy').onclick=async()=>{const subject=$('phEmailSubject').value.trim(),body=$('phEmailBody').value.trim();if(!subject||!body)return alert('Enter a subject and message first.');try{await navigator.clipboard.writeText('To: '+$('phEmailTo').value+'\nSubject: '+subject+'\n\n'+body);alert('Email copied. No message has been sent.')}catch{alert('Copy unavailable in this browser. Select and copy the message manually.')}};
$('phEmailDraft').onclick=()=>{const c=data.customers.find(x=>x.id===$('phEmailDialog').dataset.customerId);if(!c)return;$('phEmailSubject').value='Following up';$('phEmailBody').value=`Hello ${c.name},\n\nI wanted to follow up and see if you have any questions or if there is anything I can help with.\n\nBest regards,`};
 $('phEmailForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const customerId=$('phEmailDialog').dataset.customerId;
  const c=data.customers.find(x=>x.id===customerId);
  const to=$('phEmailTo').value.trim(),subject=$('phEmailSubject').value.trim(),body=$('phEmailBody').value.trim();
  if(!c||!to||!subject||!body)return alert('Select a customer and complete the email.');
  if(c.email.trim().toLowerCase()!==to.toLowerCase())return alert('Customer email has changed. Reopen the composer.');
  if(!window.wealthforgeAuthClient)return alert('Sign in under Account first.');
  const btn=$('phEmailForm').querySelector('[type=submit]');
  btn.disabled=true;
  try{
   const {data:authData,error:authError}=await window.wealthforgeAuthClient.auth.getSession();
   const session=authData?.session;
   if(authError||!session?.access_token)throw Error('Sign in under Account first.');
   if(!confirm('Send this REAL email through ProfitHarbor AI?\n\nTo: '+to+'\nSubject: '+subject+'\n\nAn accepted send will be recorded in Customer History.'))return;
   const response=await fetch('https://wealthforge-ai-api.bluemagic920.workers.dev/api/customer-email',{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({customerId,to,subject,text:body})
   });
   let result={};try{result=await response.json()}catch{}
   if(!response.ok)throw Error(result.error||'Email rejected (HTTP '+response.status+')');
   if(!result.accepted)throw Error('Email acceptance could not be confirmed.');
       // The server-side audit is authoritative; never duplicate it into editable customer notes.
    $('phHistoryCustomer').value=customerId;phRenderHistory();
    window.phLoadProtectedAudit?.(customerId);
$('phEmailDialog').close();
   alert('Resend accepted the email. The protected audit record can be viewed in Customer History. Delivery is not yet confirmed.');
  }catch(err){alert('Email not sent: '+(err?.message||'Unknown error')+'\nNo successful-send history entry was created.');}
  finally{btn.disabled=false;}
 });
$('customerRows').addEventListener('click',e=>{
 const email=e.target.closest('[data-email]');if(email){const c=data.customers.find(x=>x.id===email.dataset.email);if(!c||!c.email)return;$('phEmailDialog').dataset.customerId=c.id;$('phEmailTo').value=c.email;$('phEmailSubject').value='';$('phEmailBody').value='';$('phEmailDialog').showModal();return;}
 const edit=e.target.closest('[data-edit]');
 if(edit){
  const c=data.customers.find(x=>x.id===edit.dataset.edit);if(!c)return;
  editingCustomerId=c.id;
  for(const key of ['name','email','business','value','status']){
   const control=$('customerForm').elements.namedItem(key);if(control)control.value=c[key]??'';
  }
  $('customerFormHeading').textContent='Edit customer';$('customerSaveButton').textContent='Save changes';
  $('customerCancelEdit').hidden=false;$('customerEditNotice').hidden=false;
  $('customerForm').scrollIntoView({behavior:'smooth',block:'start'});
  return;
 }
 const b=e.target.closest('[data-remove]');
 if(b&&confirm('Delete this customer? Note: v1.7.1 synchronizes deletions to the cloud when there is no conflict.')){
  data.customers=data.customers.filter(c=>c.id!==b.dataset.remove);
  if(editingCustomerId===b.dataset.remove)resetCustomerEditor();
  save();
 }
});$('generate').onclick=()=>{const c=data.customers.find(c=>c.id===$('draftCustomer').value);if(!c){alert('Add a customer first.');return}const p=$('purpose').value,t=$('tone').value;const greeting=t==='Concise'?`Hi ${c.name},`:`Hello ${c.name},`;const body=p==='Initial outreach'?'I wanted to introduce myself and learn more about your goals.':p==='Check-in'?'I wanted to check in and see how things are going.':'I am following up on the proposal and would be happy to answer any questions.';const closing=t==='Friendly'?'Looking forward to connecting!':t==='Concise'?'Thanks,':'Please let me know if a conversation would be helpful.\n\nBest regards,';$('draftText').value=`${greeting}\n\n${body}\n\n${closing}`};$('saveDraft').onclick=()=>{if(!$('draftText').value.trim())return alert('Generate or enter a draft first.');data.drafts.unshift({id:crypto.randomUUID(),text:$('draftText').value,created:new Date().toISOString()});save()};$('copyDraft').onclick=async()=>{try{await navigator.clipboard.writeText($('draftText').value);alert('Draft copied.')}catch{alert('Select the draft text and copy manually.')}};document.querySelectorAll('[data-workflow]').forEach(b=>b.onclick=()=>{data.workflows.push({id:crypto.randomUUID(),name:b.dataset.workflow,created:new Date().toISOString()});save()});$('workflowList').onclick=e=>{const b=e.target.closest('[data-delete-workflow]');if(b){data.workflows=data.workflows.filter(w=>w.id!==b.dataset.deleteWorkflow);save()}};$('export').onclick=()=>{const blob=new Blob([JSON.stringify({app:'ProfitHarbor AI',version:2,data},null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='wealthforge-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};$('import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2e6)throw Error('File too large');const x=JSON.parse(await file.text());if(x.app!=='ProfitHarbor AI'||![1,2].includes(x.version)||!x.data||!['customers','drafts','workflows'].every(k=>Array.isArray(x.data[k])))throw Error('Invalid backup');if(!confirm('Replace existing local data with this backup?'))return;data=x.data;for(const k of ['assets','goals','cash'])if(!Array.isArray(data[k]))data[k]=[];save();$('status').textContent='Backup imported.'}catch(err){$('status').textContent='Import failed: '+err.message}e.target.value=''};$('reset').onclick=()=>{if(confirm('Permanently clear all local prototype data?')){data=empty();save()}};
function refreshOpportunityEditor(){
 const select=$('phOpportunityCustomer');if(!select)return;
 const previous=select.value;
 select.innerHTML=data.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.business||'Customer')}</option>`).join('');
 if(data.customers.some(c=>c.id===previous))select.value=previous;
 loadOpportunityCustomer();
}
function loadOpportunityCustomer(){
 const c=data.customers.find(x=>x.id===$('phOpportunityCustomer').value);
 $('phOpportunityStage').disabled=!c;$('phOpportunityValue').disabled=!c;$('phOpportunitySave').disabled=!c;
 if(c){$('phOpportunityStage').value=c.status||'Lead';$('phOpportunityValue').value=Number(c.value)||0;}
 $('phOpportunityFeedback').textContent=c?'Changes require your confirmation before saving.':'Add a customer to start managing opportunities.';
}
$('phOpportunityCustomer').addEventListener('change',loadOpportunityCustomer);
$('phOpportunitySave').addEventListener('click',()=>{
 const c=data.customers.find(x=>x.id===$('phOpportunityCustomer').value);if(!c)return;
 const stage=$('phOpportunityStage').value,value=Number($('phOpportunityValue').value);
 if(!['Lead','Contacted','Qualified','Won','Lost'].includes(stage)||!Number.isFinite(value)||value<0)return alert('Choose a valid stage and a non-negative opportunity value.');
 if(c.status===stage&&Number(c.value||0)===value){$('phOpportunityFeedback').textContent='No changes to save.';return;}
 if(!confirm(`Update ${c.name}?\n\nStage: ${c.status||'Lead'} → ${stage}\nValue: ${money(c.value)} → ${money(value)}\n\nSave these changes?`))return;
 c.status=stage;c.value=value;save();$('phOpportunityFeedback').textContent='Opportunity updated and saved.';
});
function renderSignaturePipeline(){
 const root=document.getElementById('phPipelineStages');if(!root)return;
 const stages=['Lead','Contacted','Qualified','Won','Lost'];
 const customers=Array.isArray(data.customers)?data.customers:[];
 const counts=stages.map(stage=>{const matches=customers.filter(c=>c.status===stage);return {stage,count:matches.length,value:matches.reduce((sum,c)=>sum+(Number(c.value)||0),0)}});
 const max=Math.max(1,...counts.map(c=>c.count));
 root.innerHTML=counts.map(c=>`<div class="ph-pipe-stage" data-stage="${c.stage}"><div class="ph-pipe-stage-name">${c.stage}</div><div class="ph-pipe-stage-num">${c.count}</div><div class="ph-pipe-stage-value">${money(c.value)}</div><div class="ph-pipe-bar"><span style="width:${Math.round(c.count/max*100)}%"></span></div></div>`).join('');
 const active=counts.filter(c=>!['Won','Lost'].includes(c.stage));const activeCount=active.reduce((n,c)=>n+c.count,0);const activeValue=active.reduce((n,c)=>n+c.value,0);
 document.getElementById('phPipelineSummary').textContent=activeCount?`${activeCount} active ${activeCount===1?'opportunity':'opportunities'} · ${money(activeValue)} in potential pipeline value`:'Your active opportunity pipeline is ready for its first lead.';
}

function render(){
phRenderHistory();
renderSignaturePipeline();refreshOpportunityEditor();
const total=(arr)=>arr.reduce((s,x)=>s+(Number(x.amount)||0),0);
const assets=total(data.assets.filter(x=>x.type==='Asset')),debts=total(data.assets.filter(x=>x.type==='Liability'));
const income=total(data.cash.filter(x=>x.type==='Income')),expenses=total(data.cash.filter(x=>x.type==='Expense'));
$('netWorth').textContent=money(assets-debts);$('cashFlow').textContent=money(income-expenses);
$('incomeTotal').textContent=money(income);$('expenseTotal').textContent=money(expenses);$('goalCount').textContent=data.goals.length;
const net=income-expenses;const pct=income>0?expenses/income*100:null;
$('phFinNet').textContent=money(net);$('phFinNetLabel').textContent=net<0?'Expenses exceed recorded income':'Income minus expenses';
$('phFinHeadline').textContent=income===0&&expenses===0?'Your financial picture, at a glance.':net<0?'Expenses are above recorded income.':net===0?'Your monthly amounts are balanced.':'You have a positive monthly balance.';
$('phFinInsight').textContent=income===0&&expenses===0?'Add your monthly income and expenses to see a useful summary.':income===0?'You have recorded expenses but no monthly income yet. Add income to complete the picture.':`Based on your entries, ${money(Math.abs(net))} ${net<0?'more goes out than comes in':'remains after recorded expenses'} each month.`;
$('phFinBar').style.width=pct===null?'0%':Math.min(100,Math.max(0,pct))+'%';
$('phFinRatio').textContent=pct===null?'—':pct.toFixed(1)+'%';
$('phFinRecordCount').textContent=data.cash.length+' item'+(data.cash.length===1?'':'s');
$('assetList').innerHTML=data.assets.map(x=>`<p>${esc(x.name)} — ${esc(x.type)}: ${money(x.amount)} <button data-del-asset="${esc(x.id)}">Remove</button></p>`).join('')||'<p class="muted">No entries.</p>';
$('goalList').innerHTML=data.goals.map(x=>`<p>${esc(x.name)}: ${money(x.saved)} / ${money(x.target)} (${Math.min(100,Math.round(x.saved/x.target*100))}%) <button data-del-goal="${esc(x.id)}">Remove</button></p>`).join('')||'<p class="muted">No goals yet.</p>';
$('cashList').innerHTML=data.cash.map(x=>`<div class="ph-fin-entry"><div>${esc(x.name)}<span class="ph-fin-badge">${esc(x.type)}</span></div><span class="ph-fin-amount">${money(x.amount)}/mo</span><button type="button" data-del-cash="${esc(x.id)}">Remove</button></div>`).join('')||'<p class="ph-fin-empty">No monthly items yet. Add one above to get started.</p>';
renderReminders();$('customerCount').textContent=data.customers.length;$('openCount').textContent=data.customers.filter(c=>!['Won','Lost'].includes(c.status)).length;$('pipelineValue').textContent=money(data.customers.filter(c=>!['Won','Lost'].includes(c.status)).reduce((s,c)=>s+(Number(c.value)||0),0));if($('draftCount'))$('draftCount').textContent=data.drafts.length;renderCustomerDirectory();$('draftCustomer').innerHTML=data.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('draftList').innerHTML=data.drafts.map(d=>`<div class="panel"><small>${esc(new Date(d.created).toLocaleString())}</small><p style="white-space:pre-wrap">${esc(d.text)}</p></div>`).join('')||'<p>No saved drafts.</p>';$('workflowList').innerHTML=data.workflows.map(w=>`<p>${esc(w.name)} <button data-delete-workflow="${esc(w.id)}">Remove</button></p>`).join('')||'<p>No workflows planned.</p>'}


// Customer interactions live on existing customer objects, retaining current cloud-sync data shape.
function phRenderHistory(){
 const sel=$('phHistoryCustomer'),previous=sel.value;
 sel.innerHTML=data.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.business?' · '+esc(c.business):''}</option>`).join('');
 if(data.customers.some(c=>c.id===previous))sel.value=previous;
 const customer=data.customers.find(c=>c.id===sel.value);
 $('phHistoryForm').querySelector('button[type=submit]').disabled=!customer;
 phRefreshIntelligence();
 const entries=customer&&Array.isArray(customer.interactions)?customer.interactions:[];
 $('phHistoryTimeline').innerHTML=customer?(entries.length?entries.slice().sort((a,b)=>new Date(b.when)-new Date(a.when)).map(item=>`<article class="ph-history-entry"><strong>${esc(item.type||'Note')}${item.providerId?' · Legacy editable copy':''}</strong> <small>· ${esc(new Date(item.when).toLocaleString())}</small><p>${esc(item.summary||'')}</p>${item.next?`<small>Next action: ${esc(item.next)}</small>`:''}<div><button type="button" data-history-delete="${esc(item.id)}">Delete entry</button></div></article>`).join(''):'<p class="note">No interactions recorded for this customer yet.</p>'):'<p class="note">Add a customer first to start their timeline.</p>';
}
$('phHistoryCustomer').addEventListener('change',()=>{phRenderHistory();$('phHistoryFeedback').textContent='';});
$('phHistoryWhen').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
$('phHistoryForm').addEventListener('submit',e=>{
 e.preventDefault();const c=data.customers.find(x=>x.id===$('phHistoryCustomer').value);if(!c)return;
 const summary=$('phHistorySummary').value.trim(),next=$('phHistoryNext').value.trim(),when=new Date($('phHistoryWhen').value);
 if(!summary||!Number.isFinite(when.getTime()))return alert('Enter a summary and valid date.');
 if(!confirm(`Save ${$('phHistoryType').value.toLowerCase()} interaction for ${c.name}?`))return;
 if(!Array.isArray(c.interactions))c.interactions=[];
 c.interactions.push({id:crypto.randomUUID(),type:$('phHistoryType').value,when:when.toISOString(),summary,next});
 $('phHistorySummary').value='';$('phHistoryNext').value='';save();$('phHistoryFeedback').textContent='Interaction saved to customer record.';
});
$('phHistoryTimeline').addEventListener('click',e=>{
 const btn=e.target.closest('[data-history-delete]');if(!btn)return;
 const c=data.customers.find(x=>x.id===$('phHistoryCustomer').value);if(!c||!Array.isArray(c.interactions))return;
 if(!confirm('Delete this interaction from the customer history?'))return;
 c.interactions=c.interactions.filter(i=>i.id!==btn.dataset.historyDelete);save();$('phHistoryFeedback').textContent='Interaction deleted.';
});


// v2.0.3: browser-only customer intelligence. No automatic transmission of customer details.
function phRefreshIntelligence(){
 const c=data.customers.find(x=>x.id===$('phHistoryCustomer').value);
 const pulse=$('phIntelPulse'),next=$('phIntelNext'),opp=$('phIntelOpportunity'),draft=$('phIntelDraft');
 if(!c){pulse.textContent='Add a customer to begin.';next.textContent='—';opp.textContent='—';draft.value='';return;}
 const entries=(Array.isArray(c.interactions)?c.interactions:[]).slice().filter(x=>x&&x.when&&!isNaN(new Date(x.when))).sort((a,b)=>new Date(b.when)-new Date(a.when));
 const last=entries[0],days=last?Math.max(0,Math.floor((Date.now()-new Date(last.when).getTime())/86400000)):null;
 const outstanding=entries.find(x=>String(x.next||'').trim());
 const stage=String(c.status||'Lead'),value=Math.max(0,Number(c.value)||0);
 pulse.textContent=entries.length?`${entries.length} logged interaction${entries.length===1?'':'s'}. Latest: ${last.type||'Note'} ${days===0?'today':days===1?'yesterday':days+' days ago'}.`:'No conversations recorded yet. Start with an introduction or discovery call.';
 next.textContent=outstanding?`Recorded next action: ${String(outstanding.next).slice(0,180)}`:stage==='Won'?'Thank the customer, confirm delivery, and discuss future needs.':stage==='Lost'?'Document the outcome and decide whether a future check-in is appropriate.':days===null?'Make initial contact and record the outcome.':days>=7?'Schedule a thoughtful follow-up; the last recorded interaction was over a week ago.':'Review the latest discussion and confirm the next step.';
 opp.textContent=stage==='Won'?`Won opportunity · ${money(value)} recorded value.`:stage==='Lost'?`Lost opportunity · ${money(value)} recorded value.`:`${stage} stage · ${money(value)} potential value (not guaranteed revenue).`;
 const name=String(c.name||'').trim().split(/\s+/)[0]||'there';
 const intro=stage==='Won'?'Thank you for working with us. I wanted to check in and make sure everything is going smoothly.':stage==='Lost'?'I appreciated the opportunity to connect. If your priorities change in the future, I would be glad to reconnect.':entries.length?'I wanted to follow up on our recent conversation and see whether there are any questions I can help answer.':'I wanted to introduce myself and learn more about your current priorities.';
 draft.value=`Hello ${name},\n\n${intro}\n\nPlease let me know if a brief conversation would be helpful.\n\nBest regards,`;
}
$('phIntelGenerate').onclick=()=>{phRefreshIntelligence();$('phIntelFeedback').textContent='Briefing and draft refreshed from saved customer activity.';};
$('phIntelCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('phIntelDraft').value);$('phIntelFeedback').textContent='Draft copied. Review before sending.';}catch{$('phIntelDraft').focus();$('phIntelDraft').select();$('phIntelFeedback').textContent='Select and copy the draft manually.';}};
$('phIntelAI').onclick=()=>{
 const c=data.customers.find(x=>x.id===$('phHistoryCustomer').value);if(!c)return;
 const entries=Array.isArray(c.interactions)?c.interactions:[];
 const kinds=entries.map(x=>String(x.type||'Note')).filter(x=>['Call','Meeting','Email','Note','Follow-up'].includes(x));
 const counts={};kinds.forEach(x=>counts[x]=(counts[x]||0)+1);
 const stage=['Lead','Contacted','Qualified','Won','Lost'].includes(c.status)?c.status:'Lead';
 const prompt=`Act as a professional small-business relationship strategist. Using only this anonymized context, suggest three practical next steps and draft a concise follow-up email without inventing facts. Customer stage: ${stage}. Logged interactions: ${entries.length}. Interaction types: ${Object.entries(counts).map(([k,v])=>k+' '+v).join(', ')||'none'}. Do not assume a deal is guaranteed. Use [Customer Name] as a placeholder.`;
 if(!confirm('Open AI Assistant with an anonymized prompt? Only stage and interaction counts/types will be included. You can review the prompt before sending it to Gemini.'))return;
 $('aiPrompt').value=prompt;document.querySelector('[data-tab="assistant"]').click();$('aiPrompt').focus();
};

// Follow-up MVP: reminder data stored on existing customer records for existing cloud sync.
const reminderTime=c=>c.followUpAt?new Date(c.followUpAt).getTime():NaN;
const dayStart=t=>new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime();
const followState=c=>{const t=reminderTime(c);if(!Number.isFinite(t))return null;const today=dayStart(new Date());return t<today?'overdue':t<today+86400000?'today':'upcoming'};
let notified=new Set();
function renderReminders(){
 const now=Date.now(), items=data.customers.filter(c=>Number.isFinite(reminderTime(c))).sort((a,b)=>reminderTime(a)-reminderTime(b));
 const counts={overdue:0,today:0,upcoming:0};items.forEach(c=>counts[followState(c)]++);
 $('overdueCount').textContent=counts.overdue;$('todayCount').textContent=counts.today;$('upcomingCount').textContent=counts.upcoming;
 $('dashOverdue').textContent=counts.overdue;$('dashToday').textContent=counts.today;$('dashUpcoming').textContent=counts.upcoming;
 const preview=items.filter(c=>reminderTime(c)<=now+7*86400000).slice(0,3);
 $('dashboardReminderPreview').innerHTML=preview.map(c=>{const state=followState(c);return `<div class="dash-reminder ${state}"><strong>${esc(c.name)}</strong><small>${esc(new Date(c.followUpAt).toLocaleString())} · ${esc(state)}</small><p>${esc(c.followUpReason||'Follow up with customer')}</p></div>`}).join('')||'<p class="note">No follow-ups due in the next seven days.</p>';
 const due=counts.overdue+counts.today;$('dashboardFollowups').textContent=due;$('followBellCount').textContent=due;$('followBellCount').hidden=!due;
 // Banner uses the same customer reminders as the existing notification checker.
 const attention=items.filter(c=>reminderTime(c)<=now);
 const banner=$('phFollowBanner');
 banner.classList.toggle('is-visible',attention.length>0);
 banner.classList.toggle('has-overdue',attention.some(c=>followState(c)==='overdue'));
 $('phBannerCount').textContent=attention.length+' due / overdue';
 $('phBannerItems').innerHTML=attention.slice(0,3).map(c=>`<div class="ph-banner-item"><strong>${esc(c.name)}</strong><small>${esc(new Date(c.followUpAt).toLocaleString())} · ${followState(c)==='overdue'?'Overdue':'Due now'}</small><p>${esc(c.followUpReason||'Follow up with customer')}</p></div>`).join('')+(attention.length>3?`<div class="ph-banner-item"><strong>+${attention.length-3} more</strong><p>Open Follow-Ups to see all customers.</p></div>`:'');
 const selected=$('reminderCustomer').value;$('reminderCustomer').innerHTML=data.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');if(data.customers.some(c=>c.id===selected))$('reminderCustomer').value=selected;
 $('reminderList').innerHTML=items.map(c=>{const state=followState(c),time=new Date(c.followUpAt).toLocaleString();return `<div class="reminder-item reminder-${state}"><strong>${esc(c.name)}</strong> <small>· ${esc(state.toUpperCase())} · ${esc(time)}</small><p>${esc(c.followUpReason||'Follow up with customer')}</p><button data-reminder-complete="${esc(c.id)}">Mark complete</button><button data-reminder-snooze="${esc(c.id)}">Snooze 1 day</button><button data-reminder-reschedule="${esc(c.id)}">Reschedule</button></div>`}).join('')||'<p class="note">No reminders yet. Choose a customer and schedule one above.</p>';
 if(typeof Notification!=='undefined'&&Notification.permission==='granted'&&document.visibilityState==='visible'){
  items.filter(c=>reminderTime(c)<=now).forEach(c=>{const key=c.id+'|'+c.followUpAt;if(notified.has(key))return;notified.add(key);try{new Notification('ProfitHarbor AI — Customer follow-up',{body:c.name+': '+(c.followUpReason||'Follow up'),tag:'ph-'+c.id})}catch{}});
 }
}
$('reminderForm').addEventListener('submit',e=>{e.preventDefault();const c=data.customers.find(x=>x.id===$('reminderCustomer').value);if(!c)return alert('Add a customer first.');const when=new Date($('reminderWhen').value);if(!Number.isFinite(when.getTime()))return alert('Choose a valid date and time.');const reason=$('reminderReason').value.trim();if(!reason)return alert('Enter a reason.');c.followUpAt=when.toISOString();c.followUpReason=reason;save();$('reminderReason').value='';$('reminderStatus').textContent='Reminder saved to this customer record.'});
$('reminderList').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.reminderComplete||b.dataset.reminderSnooze||b.dataset.reminderReschedule;const c=data.customers.find(x=>x.id===id);if(!c)return;
 if(b.dataset.reminderComplete){if(!confirm('Mark this follow-up complete?'))return;delete c.followUpAt;delete c.followUpReason;}
 else if(b.dataset.reminderSnooze){c.followUpAt=new Date(Math.max(Date.now(),reminderTime(c))+86400000).toISOString();}
 else {const v=prompt('New date/time (YYYY-MM-DD HH:MM)',new Date(c.followUpAt).toLocaleString('sv-SE').slice(0,16));if(v===null)return;const d=new Date(v.replace(' ','T'));if(!Number.isFinite(d.getTime()))return alert('Invalid date/time');c.followUpAt=d.toISOString();}
 save();});
$('allowNotifications').onclick=async()=>{if(!('Notification' in window))return $('reminderStatus').textContent='Browser notifications are not supported here.';try{const status=await Notification.requestPermission();$('reminderStatus').textContent='Notification permission: '+status+'. Alerts only appear while this website is open.'}catch(e){$('reminderStatus').textContent=e.message}};
$('dashboardFollowupsGo').onclick=()=>document.querySelector('[data-tab="followups"]').click();
$('dashboardAlertsGo').onclick=()=>document.querySelector('[data-tab="followups"]').click();
$('phBannerView').onclick=()=>document.querySelector('[data-tab="followups"]').click();
setInterval(renderReminders,60000);

function addForm(id,collection,fields){$(id).addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);const x={id:crypto.randomUUID()};for(const k of fields)x[k]=k==='amount'||k==='target'||k==='saved'?Number(f.get(k)):String(f.get(k)).trim();if(!x.name||fields.some(k=>['amount','target','saved'].includes(k)&&(!Number.isFinite(x[k])||x[k]<0))||(x.target!==undefined&&x.target<=0))return alert('Enter valid values.');data[collection].push(x);e.target.reset();save()})}
addForm('assetForm','assets',['name','type','amount']);addForm('goalForm','goals',['name','target','saved']);addForm('cashForm','cash',['name','type','amount']);
for(const [container,key,attribute] of [['assetList','assets','delAsset'],['goalList','goals','delGoal'],['cashList','cash','delCash']]){
 $(container).addEventListener('click',e=>{const b=e.target.closest('button');if(!b||!b.dataset[attribute])return;if(!confirm('Remove this entry?'))return;data[key]=data[key].filter(x=>x.id!==b.dataset[attribute]);save()});
}
$('calculate').onclick=()=>{const p=Number($('calcStart').value),m=Number($('calcMonthly').value),r=Number($('calcRate').value),y=Number($('calcYears').value);
 if(![p,m,r,y].every(Number.isFinite)||p<0||m<0||r < -99||r>100||y<1||y>80)return alert('Check calculator inputs.');
 const n=Math.round(y*12),rate=r/1200;let v=p;for(let i=0;i<n;i++)v=v*(1+rate)+m;
 $('calcResult').textContent=money(v);$('calcDetails').textContent='Contributions: '+money(p+m*n)+' · Hypothetical growth: '+money(v-p-m*n);
};
$('estimate').onclick=()=>{const n=Number($('subscribers').value),p=Number($('subPrice').value);if(!Number.isFinite(n)||!Number.isFinite(p)||n<0||p<0)return alert('Enter valid amounts.');$('revenueResult').textContent=money(n*p)+' / month gross'};
$('calculate').click();$('estimate').click();
render()})();
