/* ProfitHarbor AI Stage 14 — synthetic staging test only. */
(()=>{'use strict';
const root=document.getElementById('leads');if(!root)return;
const box=document.createElement('div');box.className='panel';box.id='phStage14Test';
box.innerHTML='<h3>Staging security test</h3><p class="note">Runs one synthetic submission and duplicate replay test. Does not create a real customer or enable public forms.</p><button type="button" id="phStage14Run">Run staging test</button><p class="note" id="phStage14Result" role="status">Ready when signed in.</p>';
const anchor=document.getElementById('phRealLeadHandoff');if(anchor)anchor.insertAdjacentElement('afterend',box);else root.append(box);
const btn=box.querySelector('#phStage14Run'),result=box.querySelector('#phStage14Result');
const api='https://profitharbor-leads-staging.bluemagic920.workers.dev';
async function request(path,token,body){const r=await fetch(api+path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error((j.error||'HTTP '+r.status)+' ('+r.status+')');return j;}
btn.addEventListener('click',async()=>{btn.disabled=true;result.textContent='Running safe synthetic test…';try{
 const auth=window.wealthforgeAuthClient;if(!auth)throw Error('Sign in under Account first.');
 const {data,error}=await auth.auth.getSession();const token=data?.session?.access_token;if(error||!token)throw Error('Sign in under Account first.');
 const j=await request('/api/leads/campaigns',token);const cs=(j.campaigns||[]).filter(c=>c.status!=='archived');if(!cs.length)throw Error('Create a campaign first.');
 const preferred=document.getElementById('phRealCampaign')?.value;const c=cs.find(x=>x.id===preferred)||cs[0];
 const nonce=crypto.randomUUID(),payload={ph_campaign:c.id,full_name:'Stage 14 Synthetic Test',email:'stage14-'+nonce.slice(0,8)+'@example.com',phone:'',message:'Synthetic test only',consent:true,test_submission_id:nonce,website:''};
 const first=await request('/api/leads/staging-test-submit',token,payload);
 const second=await request('/api/leads/staging-test-submit',token,payload);
 const report=await request('/api/leads/staging-test-report',token);
 const found=(report.leads||[]).some(x=>x.test_submission_id===nonce&&x.campaign_id===c.id);
 const pass=first.saved===true&&second.duplicate===true&&found;
 result.textContent=(pass?'PASS':'CHECK REQUIRED')+' — '+c.name+' · saved: '+(first.saved===true?'yes':'no')+' · duplicate blocked: '+(second.duplicate===true?'yes':'no')+' · in staging report: '+(found?'yes':'no')+'. Public collection remains OFF.';
 }catch(e){result.textContent='Test stopped: '+e.message;}finally{btn.disabled=false;}});
})();
