(()=>{'use strict';
const $=id=>document.getElementById(id), fmt=c=>(c/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
let salesReady=false, saving=false, sales=[], voidEnabled=false;
const ctx=()=>window.PHInsights;
function message(t){$('salesStatus').textContent=t}
function options(){const x=ctx();if(!x)return;const cs=$('saleCustomer'),cp=$('saleCampaign');cs.length=1;cp.length=1;
 (x.customers||[]).forEach((r,i)=>{const p=r.payload||{};const name=[p.name,p.fullName,p.customerName,[p.firstName,p.lastName].filter(Boolean).join(' '),p.company,p.companyName].find(v=>typeof v==='string'&&v.trim())||'Customer '+(i+1);const o=new Option(name.slice(0,160),name.slice(0,160));cs.add(o)});
 (x.campaigns||[]).forEach(c=>{const o=new Option((c.name||'Unnamed campaign').slice(0,160),String(c.id||''));o.dataset.label=(c.name||'Unnamed campaign').slice(0,160);cp.add(o)});
}
async function load(){message('Loading recorded sales…');const c=ctx()?.client;if(!c){message('Sales connection unavailable: Supabase client not initialized.');return}const {data:{user},error:authError}=await c.auth.getUser();if(authError){message('Sales sign-in check failed: '+authError.message);return}if(!user){message('Sign in to the existing website first.');return}
 let {data,error}=await c.from('ph_sales').select('id,amount_cents,sale_date,customer_label,campaign_label,description,status,voided_at').eq('user_id',user.id).order('sale_date',{ascending:false}).limit(1001);
 voidEnabled=!error;
 if(error && (/status|voided_at|column|schema cache/i.test(error.message||''))){
   ({data,error}=await c.from('ph_sales').select('id,amount_cents,sale_date,customer_label,campaign_label,description').eq('user_id',user.id).order('sale_date',{ascending:false}).limit(1001));
   voidEnabled=false;
 }
 if(error){salesReady=false;message('Sales storage not ready. The owner must first run business-insights-sales.sql in Supabase. Details: '+error.message);return}
 if((data||[]).length>1000){salesReady=false;message('More than 1000 sales exist. Totals cannot be shown accurately in this preview.');return}salesReady=true;sales=data||[];render();message(voidEnabled?'Sales storage connected. Sales are private to the signed-in account.':'Sales storage connected. Void is unavailable until the optional v0.5 migration is reviewed and installed.');}
function chart(container,items,labels){
 const el=$(container);if(!el)return;el.replaceChildren();
 if(!items.length){const e=document.createElement('div');e.className='empty';e.textContent='No recorded sales for this chart yet.';el.append(e);return}
 const max=Math.max(1,...items.map(x=>x.value));
 const bars=document.createElement('div');bars.className='bars';bars.style.height='190px';
 items.forEach((x,i)=>{const b=document.createElement('span');b.style.height=Math.max(3,x.value/max*100)+'%';b.style.background=['linear-gradient(0deg,#1e5cb8,#4ca9ff)','linear-gradient(0deg,#6536ae,#b48bff)','linear-gradient(0deg,#098f7c,#37e0bc)','linear-gradient(0deg,#ae7d18,#f3c86b)'][i%4];b.title=x.label+': '+fmt(x.value);bars.append(b)});
 const legend=document.createElement('div');legend.className='barlabels';items.forEach(x=>{const t=document.createElement('span');t.textContent=x.label+' · '+fmt(x.value);legend.append(t)});el.append(bars,legend);
}
function render(){
 const active=sales.filter(s=>s.status!=='voided');const total=active.reduce((a,s)=>a+Number(s.amount_cents),0);
 const area=$('salesList');area.replaceChildren();const heading=document.createElement('strong');heading.textContent=active.length+' active sale(s) · '+fmt(total)+' recorded revenue';area.append(heading);
 sales.slice(0,30).forEach(s=>{const d=document.createElement('div');d.style.cssText='padding:9px 0;border-bottom:1px solid #31435c;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap';const t=document.createElement('span');t.textContent=s.sale_date+' · '+fmt(s.amount_cents)+(s.customer_label?' · '+s.customer_label:'')+(s.campaign_label?' · '+s.campaign_label:'')+(s.status==='voided'?' · VOIDED':'');d.append(t);
 if(voidEnabled && s.status!=='voided'){const b=document.createElement('button');b.textContent='Void';b.className='tab';b.type='button';b.title='Mark this sale as void without deleting its history';b.addEventListener('click',()=>voidSale(s));d.append(b)}area.append(d)});
 const metrics=document.querySelectorAll('#overview .metric strong.real');if(metrics[0])metrics[0].textContent=fmt(total);if(metrics[2])metrics[2].textContent=String(active.length);if(metrics[3])metrics[3].textContent=active.length?fmt(Math.round(total/active.length)):'—';
 const linked=active.filter(s=>s.campaign_label),leadTotal=linked.reduce((a,s)=>a+Number(s.amount_cents),0);const leadMetric=document.querySelector('#leads .metric strong.real');if(leadMetric)leadMetric.textContent=fmt(leadTotal);const cm=document.querySelectorAll('#campaigns .metric strong.real');if(cm[1])cm[1].textContent=fmt(leadTotal);
 const months=new Map();for(const s of active){const k=s.sale_date.slice(0,7);months.set(k,(months.get(k)||0)+Number(s.amount_cents))}chart('revenueChart',[...months].sort((a,b)=>a[0].localeCompare(b[0])).slice(-6).map(([label,value])=>({label,value})));
 const campaigns=new Map();for(const s of linked){const k=s.campaign_label;campaigns.set(k,(campaigns.get(k)||0)+Number(s.amount_cents))}const grouped=[...campaigns].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value])=>({label,value}));chart('leadRevenueChart',grouped);const history=$('campaignHistory');if(history){const old=history.querySelector('.revenue-by-campaign');if(old)old.remove();const sub=document.createElement('div');sub.className='revenue-by-campaign';const title=document.createElement('h3');title.textContent='Recorded revenue by campaign';sub.append(title);const target=document.createElement('div');target.id='campaignRevenueBars';sub.append(target);history.append(sub);chart('campaignRevenueBars',grouped)}
 const summary=document.querySelector('#overview .insight p.real');if(summary)summary.textContent=active.length?('You recorded '+active.length+' sale(s) totaling '+fmt(total)+'. This is revenue, not profit. Trends are based only on recorded sales; missing costs are not estimated.'):'No sales recorded yet. Record a sale to see your revenue trend. No figures are estimated.';
}
async function voidSale(s){if(!salesReady)return;const reason=prompt('Reason for voiding this sale (required):');if(reason===null)return;if(!reason.trim()||reason.trim().length>250){message('Enter a reason between 1 and 250 characters.');return}if(!confirm('Void '+fmt(s.amount_cents)+' sale from '+s.sale_date+'? This excludes it from revenue totals and retains an audit record.'))return;
 const c=ctx()?.client;const {data:{user}}=await c.auth.getUser();if(!user)return;
 const {data,error}=await c.rpc('ph_void_sale',{p_sale_id:s.id,p_reason:reason.trim()});if(error){message('Void failed: '+error.message+' — no sale was changed by this request.');return}if(data!==true){message('Void not confirmed by server. Refresh and verify sale status.');return}await load();message('Sale voided. The original record is retained for auditing.')}
$('recordSale').addEventListener('click',()=>{options();$('saleMessage').textContent='';$('saleDate').value=new Date().toLocaleDateString('en-CA');$('saleOverlay').classList.remove('hidden');$('saleAmount').focus()});
function close(){$('saleOverlay').classList.add('hidden')};$('cancelSale').addEventListener('click',close);
$('saleForm').addEventListener('submit',async e=>{e.preventDefault();if(saving)return;if($('demo').checked){$('saleMessage').textContent='Turn off illustrative sample data before saving a real sale.';return}if(!salesReady){$('saleMessage').textContent='Sales storage is not connected. Sign in and use Refresh Data, then retry.';return}
 const amount=$('saleAmount').value.trim();if(!/^\d+(\.\d{1,2})?$/.test(amount)){ $('saleMessage').textContent='Enter a positive amount with up to two decimal places.';return}const cents=Math.round(Number(amount)*100);if(!Number.isSafeInteger(cents)||cents<1||cents>99999999900){$('saleMessage').textContent='Invalid sale amount.';return}
 const c=ctx().client;const {data:{user},error:authError}=await c.auth.getUser();if(authError||!user){$('saleMessage').textContent='Sign in again before saving.';return}
 const selected=$('saleCampaign').selectedOptions[0];const payload={id:crypto.randomUUID(),user_id:user.id,amount_cents:cents,currency:'USD',sale_date:$('saleDate').value,customer_label:$('saleCustomer').value||null,campaign_id:selected?.value||null,campaign_label:selected?.value?(selected.dataset.label||selected.textContent):null,description:$('saleDescription').value.trim()||null};
 saving=true;$('saveSale').disabled=true;$('saleMessage').textContent='Saving…';try{const {error}=await c.from('ph_sales').insert(payload);if(error)throw error;close();$('saleForm').reset();await load();}catch(err){$('saleMessage').textContent='Save failed: '+err.message+' (no success recorded).'}finally{saving=false;$('saveSale').disabled=false}
});
document.addEventListener('ph-insights-data',options);document.addEventListener('ph-insights-connected',load);
// Independently load saved sales at startup; customer/campaign loading is separate.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>load().catch(e=>message('Sales loading error: '+e.message)),{once:true});
else load().catch(e=>message('Sales loading error: '+e.message));
})();