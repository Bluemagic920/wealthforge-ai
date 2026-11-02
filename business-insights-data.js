(()=>{'use strict';
// Read-only test integration. Uses the existing public Supabase publishable key.
const URL='https://nhiqbcevcdxfzvrprgck.supabase.co';
const KEY='sb_publishable_VwM3o7h2Jxq9_2WkkdE4kg_WKU6bvP6';
const API='https://profitharbor-leads-api.bluemagic920.workers.dev/api/leads/campaigns';
const el=id=>document.getElementById(id);
const status=(message)=>{const node=el('connectionStatus');node.textContent=message;node.hidden=!message;};
const client=window.supabase?.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
window.PHInsights={client,customers:[],campaigns:[]};
let busy=false;
async function connect(){
 if(busy)return;
 if(!client){status('Supabase library unavailable. Check the network and retry.');return}
 busy=true;el('connectData').disabled=true;status('Checking sign-in and loading read-only records…');
 try{
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user){status('Not signed in. Open Existing Website, sign in under Account, then return here and connect.');return}
  // Query with the signed-in user's JWT. Supabase RLS must restrict rows to this owner.
  const {data:rows,error:rowsError}=await client.from('wealthforge_records').select('record_type,payload').eq('user_id',user.id).eq('record_type','customer').limit(1001);
  if(rowsError)throw new Error('Customer records: '+rowsError.message);
  if(rows.length>1000)throw new Error('Customer record limit reached; cannot show an accurate total.');
  window.PHInsights.customers=rows;document.dispatchEvent(new Event('ph-insights-data'));
  el('realCustomers').textContent=String(rows.length);
  const customerHistory=el('customerHistory');customerHistory.replaceChildren();
  const title=document.createElement('b');title.textContent=rows.length+' customer record(s) loaded';
  const note=document.createElement('p');note.textContent='Real customer total from your signed-in account. Growth by month is hidden until creation dates are verified.';
  customerHistory.append(title,note);
  let campaignsMessage='Campaign service not checked.';
  try{
   const {data:{session}}=await client.auth.getSession();
   if(!session?.access_token)throw new Error('Session unavailable');
   const response=await fetch(API,{method:'GET',headers:{Authorization:'Bearer '+session.access_token}});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error||'HTTP '+response.status);
   if(!Array.isArray(json.campaigns))throw new Error('Unexpected campaign response');
   window.PHInsights.campaigns=json.campaigns;document.dispatchEvent(new Event('ph-insights-data'));
   el('realCampaigns').textContent=String(json.campaigns.length);
   const area=el('campaignHistory');area.replaceChildren();
   const heading=document.createElement('b');heading.textContent=json.campaigns.length+' saved campaign(s)';area.append(heading);
   const note=document.createElement('p');note.textContent='Draft and archived campaigns only. These are not measured ad results or generated revenue.';area.append(note);
   if(json.campaigns.length){
    const list=document.createElement('div');list.style.cssText='width:100%;max-width:560px;margin:12px auto;text-align:left';
    for(const c of json.campaigns.slice(0,10)){
      const item=document.createElement('div');item.style.cssText='padding:7px 0;border-bottom:1px solid #31435c';
      item.textContent=(c.name||'Unnamed campaign')+' · '+(c.source||'Unknown source')+' · '+(c.status||'draft');list.append(item);
    }
    area.append(list);
   }
   campaignsMessage=json.campaigns.length+' campaign(s)';
  }catch(e){campaignsMessage='campaigns unavailable ('+e.message+')';}
  document.dispatchEvent(new Event('ph-insights-connected'));
  status(campaignsMessage.startsWith('campaigns unavailable') ? 'Customer records loaded; '+campaignsMessage+'.' : '');
 }catch(e){status('Could not load records: '+e.message+'. No data was modified.');}
 finally{busy=false;el('connectData').disabled=false}
}
el('connectData').addEventListener('click',connect);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',connect,{once:true});else connect();
})();
