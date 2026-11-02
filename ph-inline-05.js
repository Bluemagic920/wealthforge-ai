
(()=>{'use strict';
 const API='https://wealthforge-ai-api.bluemagic920.workers.dev/api/customer-email-history';
 const el=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let allMode=false,seq=0;
 async function load(customerId){
  const id=++seq,status=el('phAuditStatus'),timeline=el('phAuditTimeline');
  if(!status||!timeline)return;
  const filter=allMode?'':customerId||el('phHistoryCustomer')?.value||'';
  status.textContent='Loading protected email records…';timeline.innerHTML='';
  try{
   const sb=window.wealthforgeAuthClient;
   if(!sb)throw Error('Sign in under Account first.');
   const {data,error}=await sb.auth.getSession();
   if(error||!data?.session?.access_token)throw Error('Sign in under Account first.');
   const url=API+(filter?'?customerId='+encodeURIComponent(filter):'');
   const res=await fetch(url,{headers:{Authorization:'Bearer '+data.session.access_token}});
   const json=await res.json();if(!res.ok)throw Error(json.error||'Audit unavailable (HTTP '+res.status+')');
   if(id!==seq)return;
   const rows=Array.isArray(json.entries)?json.entries:[];
   status.textContent=(allMode?'All customers':'Selected customer')+' · '+rows.length+' protected record(s) · read-only';
   timeline.innerHTML=rows.length?rows.map(r=>`<article class="ph-history-entry"><strong>Sent-email audit · ${esc(r.status||'unknown')}</strong> <small>· ${esc(new Date(r.created_at).toLocaleString())}</small><p><b>To:</b> ${esc(r.recipient_email)}<br><b>Subject:</b> ${esc(r.subject)}</p><p>${esc(r.message_text)}</p><small>Customer ID: ${esc(r.customer_id)} · Provider ID: ${esc(r.provider_id||'not assigned')}</small><p class="muted">Protected server record · no delete control · status reflects the latest recorded provider response, not confirmed delivery.</p></article>`).join(''):'<p class="note">No protected email records found for this view.</p>';
  }catch(err){if(id!==seq)return;status.textContent='Protected audit could not load: '+(err?.message||'Unknown error');}
 }
 window.phLoadProtectedAudit=load;
 el('phAuditRefresh').addEventListener('click',()=>load());
 el('phAuditAll').addEventListener('click',()=>{allMode=!allMode;el('phAuditAll').textContent=allMode?'Selected customer':'All customers';load();});
 el('phHistoryCustomer').addEventListener('change',()=>{if(!allMode)load();});
 document.querySelector('[data-tab="history"]').addEventListener('click',()=>load());
})();
