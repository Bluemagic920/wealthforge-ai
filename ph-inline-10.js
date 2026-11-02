
(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
async function brand(){
 const sb=window.wealthforgeAuthClient;
 if(!sb) return {settings:{},logo:null,notice:'Cloud account unavailable; company branding not loaded.'};
 const {data:auth,error:authError}=await sb.auth.getUser();
 if(authError||!auth?.user) return {settings:{},logo:null,notice:'Sign in to load company branding.'};
 const {data,error}=await sb.from('ph_business_settings').select('settings,logo_path').eq('user_id',auth.user.id).maybeSingle();
 if(error)throw Error('Could not load branding: '+error.message);
 let logo=null,notice='';
 if(data?.logo_path){
  const {data:link,error:linkError}=await sb.storage.from('ph-company-logos').createSignedUrl(data.logo_path,60);
  if(linkError)notice='Saved logo could not be loaded: '+linkError.message;
  else {
   try {const response=await fetch(link.signedUrl);if(!response.ok)throw Error('Logo fetch failed');const blob=await response.blob();
    if(blob.size>2*1024*1024)throw Error('Logo too large');
    logo=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Logo read failed'));r.readAsDataURL(blob)});
   }catch(e){notice='Saved logo could not be embedded: '+e.message}
  }
 }
 return {settings:data?.settings||{},logo,notice};
}
function docMarkup(d,b){
 const st=b.settings||{}, lines=(d.lines||[]).map(i=>`<tr><td>${esc(i.description)}</td><td class="num">${esc(i.quantity)}</td><td class="num">${fmt(i.price)}</td><td class="num">${fmt(i.quantity*i.price)}</td></tr>`).join('');
 const company=st.sigCompany||'Your Business',name=st.sigName||'',contact=[st.sigPhone,st.sigWebsite].filter(Boolean).map(esc).join(' · ');
 return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number||d.type)} — Document Preview</title><style>
 @page{size:letter;margin:0.7in}*{box-sizing:border-box}body{margin:0;background:#e9eef2;color:#203348;font:14px Arial,Helvetica,sans-serif}.sheet{max-width:820px;margin:28px auto;background:white;padding:48px;box-shadow:0 12px 45px #20334825;min-height:850px}.head{display:flex;justify-content:space-between;gap:24px;align-items:start;border-bottom:3px solid #d2ab54;padding-bottom:25px}.logo{max-width:210px;max-height:95px;object-fit:contain;margin-bottom:10px}.brand{font-size:23px;font-weight:700;color:#123a58}.muted{color:#647588;font-size:12px;line-height:1.7}.doc-title{text-align:right;font-size:30px;font-weight:700;letter-spacing:2px;color:#123a58}.details{display:flex;justify-content:space-between;gap:30px;margin:30px 0}.details div{line-height:1.9}table{width:100%;border-collapse:collapse;margin-top:20px}th{background:#123a58;color:white;text-align:left}td,th{padding:12px 10px;border-bottom:1px solid #e4e8eb}.num{text-align:right}.totals{margin:26px 0 0 auto;max-width:270px}.totals p{display:flex;justify-content:space-between}.grand{font-size:19px;border-top:2px solid #d2ab54;padding-top:14px;font-weight:bold}.notes{margin-top:55px;white-space:pre-wrap}.actions{max-width:820px;margin:20px auto;display:flex;gap:10px}.actions button{padding:11px 18px;background:#123a58;color:white;border:0;border-radius:6px;cursor:pointer}.warn{max-width:820px;margin:12px auto;color:#8b5000}.foot{font-size:11px;color:#6b7888;margin-top:55px}@media print{body{background:white}.sheet{padding:0;margin:0;box-shadow:none;min-height:0}.actions,.warn{display:none}}
 </style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close preview</button></div>${b.notice?`<p class="warn">${esc(b.notice)}</p>`:''}<main class="sheet"><header class="head"><div>${b.logo?`<img class="logo" alt="Company logo" src="${b.logo}">`:''}<div class="brand">${esc(company)}</div><div class="muted">${esc(name)}<br>${contact}</div></div><div><div class="doc-title">${esc(d.type).toUpperCase()}</div><div class="muted" style="text-align:right">${esc(d.number||'Unsaved preview')}<br>${esc(d.status||'Draft')}</div></div></header><section class="details"><div><strong>BILL TO</strong><br>${esc(d.customer?.name)}<br>${esc(d.customer?.business||'')}<br>${esc(d.customer?.email||'')}</div><div><strong>Issue date:</strong> ${esc(d.issue)}<br><strong>${d.type==='Quote'?'Valid until':'Due date'}:</strong> ${esc(d.due||'Not specified')}</div></section><table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${lines}</tbody></table><div class="totals"><p><span>Subtotal</span><span>${fmt(d.subtotal)}</span></p><p><span>Tax (${esc(d.taxRate)}%)</span><span>${fmt(d.tax)}</span></p><p class="grand"><span>Total</span><span>${fmt(d.total)}</span></p></div><section class="notes"><strong>Terms &amp; Notes</strong><p>${esc(d.notes||'')}</p></section><p class="foot">Draft preview for review only. Not sent to customer.</p></main>
</body></html>`;
}
async function preview(d){
 const w=window.open('','_blank');if(!w){$('billStatus').textContent='Please allow pop-ups for PDF preview.';return;}
 w.document.write('<!doctype html><title>Preparing document preview</title><p style="font-family:Arial;padding:24px">Preparing branded document preview…</p>');
 try {const b=await brand();w.document.open();w.document.write(docMarkup(d,b));w.document.close();}
 catch(e){w.document.open();w.document.write('<p style="font-family:Arial;padding:24px">Could not load branding: '+esc(e.message)+'</p>');w.document.close();}
}
const billing=()=>{try{const user=localStorage.getItem('wealthforge_active_user')||'local';return JSON.parse(localStorage.getItem('ph_billing_preview_'+user)||'[]')}catch{return []}};
const current=()=>{const id=document.querySelector('#billSaved tr button[data-open]');return id};
$('billPrint').onclick=()=>{const active=billing().find(d=>d.id===window.__phLastBillingId);if(active){preview(active);return} $('billStatus').textContent='Save the document first, then click View branded PDF / Print.'};
$('billSaved').addEventListener('click',e=>{const btn=e.target.closest('button[data-pdf]');if(!btn)return;const d=billing().find(x=>x.id===btn.dataset.pdf);if(d)preview(d)});
const tbody=$('billSaved');const observe=new MutationObserver(()=>{for(const tr of tbody.querySelectorAll('tr')){const open=tr.querySelector('button[data-open]');if(!open||tr.querySelector('button[data-pdf]'))continue;const btn=document.createElement('button');btn.type='button';btn.textContent='View PDF';btn.dataset.pdf=open.dataset.open;open.parentElement.append(' ',btn)}});
observe.observe(tbody,{childList:true});
$('billSaved').addEventListener('click',e=>{const btn=e.target.closest('button[data-open],button[data-convert]');if(btn)window.__phLastBillingId=btn.dataset.open||btn.dataset.convert});
$('billSave').addEventListener('click',()=>{const rows=billing();if(rows.length)window.__phLastBillingId=rows[0].id});
})();
