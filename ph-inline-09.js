
(()=>{'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const account=()=>localStorage.getItem('wealthforge_active_user')||'local';
const key=()=>`ph_billing_preview_${account()}`;
const docs=()=>{try{return JSON.parse(localStorage.getItem(key())||'[]')}catch{return []}};
const customers=()=>{if(typeof window.phGetCurrentCustomers==='function')return window.phGetCurrentCustomers();const k=localStorage.getItem('wealthforge_active_user')?'wealthforge_user_'+account():'wealthforge_v1_local';try{return JSON.parse(localStorage.getItem(k)||'{}').customers||[]}catch{return []}};
let editing=null;
const row=(d='',q=1,p=0)=>{
 const tr=document.createElement('tr');
 tr.innerHTML=`<td><input class="bi-desc" maxlength="300" placeholder="Item or service" value="${escape(d)}"></td><td><input class="bi-qty" type="number" min=".01" step=".01" value="${q}"></td><td><input class="bi-price" type="number" min="0" step=".01" value="${p}"></td><td class="bi-amount"></td><td><button type="button" class="bi-remove" aria-label="Remove line">×</button></td>`;
 $('billItems').append(tr);tr.querySelector('.bi-remove').onclick=()=>{tr.remove();total()};tr.querySelectorAll('input').forEach(el=>el.addEventListener('input',total));total();
};
const items=()=>[...$('billItems').querySelectorAll('tr')].map(tr=>({description:tr.querySelector('.bi-desc').value.trim(),quantity:Number(tr.querySelector('.bi-qty').value),price:Number(tr.querySelector('.bi-price').value)}));
const total=()=>{
 let sub=0;[...$('billItems').querySelectorAll('tr')].forEach(tr=>{let q=Number(tr.querySelector('.bi-qty').value)||0,p=Number(tr.querySelector('.bi-price').value)||0;let v=q*p;sub+=v;tr.querySelector('.bi-amount').textContent=money(v)});
 const tax=sub*(Number($('billTax').value)||0)/100;$('billTotal').textContent=`Subtotal ${money(sub)} + tax ${money(tax)} = ${money(sub+tax)}`;return {sub,tax,grand:sub+tax};
};
const refreshCustomers=()=>{const old=$('billCustomer').value;const cs=customers();$('billCustomer').innerHTML='<option value="">Select customer</option>'+cs.map(c=>`<option value="${escape(c.id)}">${escape(c.name||'Unnamed')} — ${escape(c.email||'no email')}</option>`).join('');$('billCustomer').value=old};
const reset=()=>{editing=null;$('billType').value='Quote';$('billCustomer').value='';$('billDate').value=new Date().toISOString().slice(0,10);$('billDue').value='';$('billTax').value='0';$('billNotes').value='';$('billItems').innerHTML='';row();$('billStatus').textContent='New document';};
const current=()=>{const cs=customers(),c=cs.find(x=>x.id===$('billCustomer').value);if(!c)throw Error('Select a customer first.');
 const lines=items();if(!lines.length||lines.some(i=>!i.description||!Number.isFinite(i.quantity)||i.quantity<=0||!Number.isFinite(i.price)||i.price<0))throw Error('Add valid descriptions, quantities and prices.');
 const t=total();if(!Number.isFinite(t.grand)||t.grand>1e9)throw Error('Invalid document total.');
 return {id:editing||crypto.randomUUID(),type:$('billType').value,customerId:c.id,customer:{name:c.name,email:c.email,business:c.business},issue:$('billDate').value,due:$('billDue').value,taxRate:Number($('billTax').value),lines,notes:$('billNotes').value,subtotal:t.sub,tax:t.tax,total:t.grand,status:'Draft'};
};
const save=()=>{const d=current(),all=docs(),idx=all.findIndex(x=>x.id===d.id);if(idx>=0){d.number=all[idx].number;d.status=all[idx].status;all[idx]=d}else{d.number=(d.type==='Quote'?'Q':'INV')+'-'+Date.now();all.unshift(d)}localStorage.setItem(key(),JSON.stringify(all));editing=d.id;list();$('billStatus').textContent=d.number+' saved in this browser only. Export a PDF for safekeeping.';return d};
const load=d=>{editing=d.id;$('billType').value=d.type;refreshCustomers();$('billCustomer').value=d.customerId;$('billDate').value=d.issue;$('billDue').value=d.due;$('billTax').value=d.taxRate;$('billNotes').value=d.notes;$('billItems').innerHTML='';d.lines.forEach(x=>row(x.description,x.quantity,x.price));$('billStatus').textContent='Editing '+d.number};
const list=()=>{$('billSaved').innerHTML=docs().map(d=>`<tr><td>${escape(d.number)}</td><td>${escape(d.customer?.name)}</td><td>${money(d.total)}</td><td>${escape(d.status)}</td><td><button type="button" data-open="${escape(d.id)}">Open</button> <button type="button" data-convert="${escape(d.id)}" ${d.type==='Invoice'?'disabled':''}>Convert to invoice</button></td></tr>`).join('')||'<tr><td colspan="5">No documents yet</td></tr>'};
$('billSaved').addEventListener('click',e=>{const id=e.target.dataset.open||e.target.dataset.convert;if(!id)return;const d=docs().find(x=>x.id===id);if(!d)return;if(e.target.dataset.convert){const copy={...d,id:crypto.randomUUID(),type:'Invoice',number:'INV-'+Date.now(),status:'Draft'};localStorage.setItem(key(),JSON.stringify([copy,...docs()]));load(copy);list()}else load(d)});
$('billAdd').onclick=()=>row();$('billTax').addEventListener('input',total);$('billSave').onclick=()=>{try{save()}catch(e){$('billStatus').textContent=e.message}};
$('billReset').onclick=()=>{refreshCustomers();reset()};
$('billPrint').onclick=()=>{let d;try{d=current()}catch(e){$('billStatus').textContent=e.message;return}
 const lines=d.lines.map(i=>`<tr><td>${escape(i.description)}</td><td>${i.quantity}</td><td>${money(i.price)}</td><td>${money(i.quantity*i.price)}</td></tr>`).join('');
 const w=window.open('','_blank');if(!w){$('billStatus').textContent='Allow popups to print.';return}
 w.document.write(`<!doctype html><html><head><title>${escape(d.type)} Preview</title><style>body{font:15px Arial,sans-serif;margin:48px;color:#162b40}h1{color:#103c5a}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{padding:12px;text-align:left;border-bottom:1px solid #ccd}footer{margin-top:35px}button{padding:10px 20px}@media print{button{display:none}}</style></head><body><h1>${escape(d.type)} · Preview</h1><p><b>Customer:</b> ${escape(d.customer.name)}<br><b>Email:</b> ${escape(d.customer.email)}<br><b>Issue:</b> ${escape(d.issue)}<br><b>Due / valid until:</b> ${escape(d.due)}</p><table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${lines}</tbody></table><p style="text-align:right">Subtotal: ${money(d.subtotal)}<br>Tax: ${money(d.tax)}<br><strong>Total: ${money(d.total)}</strong></p><footer><b>Terms:</b><p>${escape(d.notes).replace(/\n/g,'<br>')}</p><p>Preview only — not a sent or finalized document.</p></footer><button onclick="print()">Print / Save as PDF</button>
</body></html>`);w.document.close();
};
document.querySelector('[data-tab="billing"]')?.addEventListener('click',()=>{refreshCustomers();list()});window.addEventListener('wealthforge:changed',refreshCustomers);
reset();list();
})();
