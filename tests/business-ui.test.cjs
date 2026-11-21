const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'..','ph-business.js'),'utf8');
class El{constructor(id){this.id=id;this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.attrs={};this.events={};this.classList={contains:()=>false};}
 getAttribute(k){return this.attrs[k]??null;}hasAttribute(k){return k in this.attrs;}removeAttribute(k){delete this.attrs[k];}addEventListener(n,f){(this.events[n]||=[]).push(f);}
 async emit(n){for(const f of this.events[n]||[])await f({preventDefault(){}});}focus(){}scrollIntoView(){}click(){this.clicked=true;}}
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};
// Loads the real script against the real page's ids and data-business attributes.
async function page({signedIn=true,respond,search=''}={}){
 const nodes=new Map();for(const m of html.matchAll(/<(\w+)\b([^>]*)\bid="(phBusiness\w+|phProStatus)"([^>]*)>/g)){const e=new El(m[3]);e.hidden=/\shidden(\s|=|$)/.test(m[2]+' '+m[4]+' ');nodes.set(m[3],e);}
 const marked=[...html.matchAll(/<(\w+)\b([^>]*\bdata-business-open="([^"]*)"[^>]*)>([^<]*)</g)].map(m=>{const e=new El();e.tag=m[1];e.attrs['data-business-open']=m[3].replaceAll('&amp;','&');e.textContent=m[4];
  const action=m[2].match(/data-business-action="(\w+)"/);if(action){e.attrs['data-business-action']=action[1];e.disabled=true;e.attrs['aria-disabled']='true';}return e;});
 const accountTab=new El('tab'),calls=[],timers=[];let located=null,interval='month',token='tok',authChange;
 const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:sel=>sel==='[data-business-open]'?marked:sel==='[data-business-action]'?marked.filter(e=>e.hasAttribute('data-business-action')):[],
  querySelector:sel=>sel==='[data-ph-target="cloud"]'?accountTab:sel.startsWith('input[name="phBusinessInterval"]')?{value:interval}:null};
 const window={location:{search,href:'https://profitharborai.com/'+search,assign(u){located=u;}},history:{replaceState(){}},addEventListener(){},
  wealthforgeAuthClient:{auth:{getSession:async()=>({data:{session:signedIn?{access_token:token}:null},error:null}),onAuthStateChange(fn){authChange=fn;}}}};
 const fetch=async(url,init={})=>{const u=new URL(url);calls.push({path:u.pathname,method:init.method,body:init.body?JSON.parse(init.body):null,auth:init.headers?.Authorization});const [status,body]=respond(u.pathname,init);return {ok:status>=200&&status<300,status,json:async()=>body};};
 vm.runInNewContext(script,{window,document,fetch,URL,URLSearchParams,setTimeout:(fn,ms)=>{timers.push(fn);return 0;},Promise,Number,Boolean,Date,Error,console});
 const run=async()=>{while(timers.length){timers.shift()();await settle();}};await run();
 return {nodes,marked,calls,run,node:id=>nodes.get(id),get located(){return located;},setInterval:v=>{interval=v;},switchAccount(v,notify=false){token=v;if(notify)authChange?.();},accountTab};
}
const base={available:true,checkoutOpen:true,mode:'live',plan:'none',active:false,lifetime:false,workspaceAccess:false,hasCompany:false,eligible:true,subscriptionStatus:'none',currentPeriodEnd:null,cancelAtPeriodEnd:false,reviewRequired:false,canManageBilling:false,employeesIncluded:20,prices:{month:12999,year:132590,currency:'usd'},ironcrestUrl:'https://ironcrest.profitharborai.com/'};
const api=(statusBody,extra={})=>(p)=>p==='/health'?[200,{ok:true,configured:true,mode:statusBody?.mode||'live',checkoutOpen:statusBody?.checkoutOpen===true}]:p==='/api/business/status'?[200,statusBody]:extra[p]||[404,{}];

test('page has every element the Business script needs',()=>{
 for(const id of ['phBusinessPanel','phBusinessStatus','phBusinessForm','phBusinessCompany','phBusinessCompanyRow','phBusinessBuy','phBusinessActions','phBusinessOpen','phBusinessManage','phBusinessMonthLabel','phBusinessYearLabel','phChooseBusiness'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.indexOf('src="ph-inline-14.js"')<html.indexOf('src="ph-business.js"'));assert.match(html,/<div class="ph-business-panel" hidden id="phBusinessPanel">/);
});
test('before launch nothing changes: Coming Soon stays and no purchase form appears',async()=>{
 for(const respond of [()=>[503,{}],api({available:false,checkoutOpen:false}),api({...base,checkoutOpen:false}),()=>{throw Error('offline');}]){
  const p=await page({respond});assert.equal(p.node('phBusinessPanel').hidden,true);assert.ok(p.marked.some(e=>e.textContent==='Coming Soon'));
  assert.ok(p.marked.filter(e=>e.hasAttribute('data-business-action')).every(e=>e.disabled===true));}
 const out=await page({signedIn:false,respond:api({...base,checkoutOpen:false})});assert.ok(out.marked.some(e=>e.textContent==='Coming Soon'));
});
test('open live checkout switches wording and shows the purchase form to an eligible owner',async()=>{
 const p=await page({respond:api(base,{'/api/business/checkout':[200,{url:'https://checkout.stripe.com/c/pay/cs_1'}]})});
 assert.ok(!p.marked.some(e=>/Coming Soon|planned/i.test(e.textContent)),'no pre-launch wording remains');
 const choose=p.marked.filter(e=>e.hasAttribute('data-business-action'));assert.equal(choose.length,2);assert.ok(choose.every(e=>e.disabled===false&&e.textContent==='Choose Business'));
 assert.equal(p.node('phBusinessPanel').hidden,false);assert.equal(p.node('phBusinessForm').hidden,false);assert.equal(p.node('phBusinessCompanyRow').hidden,false);
 assert.match(p.node('phBusinessStatus').textContent,/\$129\.99 a month or \$1,325\.90 a year/);assert.equal(p.node('phBusinessYearLabel').textContent,'Annual — $1,325.90');
 await p.node('phBusinessForm').emit('submit');await settle();assert.equal(p.calls.filter(c=>c.path==='/api/business/checkout').length,0,'company name is required');
 p.node('phBusinessCompany').value='  Riley Roofing ';p.setInterval('year');await p.node('phBusinessForm').emit('submit');await settle();
 const sent=p.calls.find(c=>c.path==='/api/business/checkout');assert.deepEqual(sent.body,{interval:'year',companyName:'Riley Roofing'});assert.equal(sent.auth,'Bearer tok');
 assert.equal(p.located,'https://checkout.stripe.com/c/pay/cs_1');
});
test('signed-out visitors see launch wording but no account details',async()=>{
 const p=await page({signedIn:false,respond:api(base)});assert.ok(!p.marked.some(e=>e.textContent==='Coming Soon'));assert.equal(p.node('phBusinessPanel').hidden,true);
 assert.ok(p.calls.every(c=>c.path==='/health'&&!c.auth));
});
test('unexpected destinations and server refusals never navigate',async()=>{
 let p=await page({respond:api({...base,hasCompany:true},{'/api/business/checkout':[200,{url:'https://evil.example/pay'}]})});
 assert.equal(p.node('phBusinessCompanyRow').hidden,true);await p.node('phBusinessForm').emit('submit');await settle();assert.equal(p.located,null);assert.match(p.node('phBusinessStatus').textContent,/Unexpected/);
 p=await page({respond:api({...base,hasCompany:true},{'/api/business/checkout':[409,{error:'Business includes Pro. Cancel your Pro subscription first.',code:'pro_subscription_active'}]})});
 await p.node('phBusinessForm').emit('submit');await settle();assert.equal(p.located,null);assert.match(p.node('phBusinessStatus').textContent,/Cancel your Pro subscription/);
});
test('active, lifetime, ended, ineligible and test-mode states',async()=>{
 let p=await page({respond:api({...base,active:true,plan:'business',workspaceAccess:true,hasCompany:true,subscriptionStatus:'active',canManageBilling:true,currentPeriodEnd:'2026-12-16T12:00:00Z'},{'/api/business/portal':[200,{url:'https://billing.stripe.com/p/session/1'}]})});
 assert.match(p.node('phBusinessStatus').textContent,/active\. Next renewal: December 16, 2026/);assert.deepEqual([p.node('phBusinessForm').hidden,p.node('phBusinessOpen').hidden,p.node('phBusinessManage').hidden],[true,false,false]);
 await p.node('phBusinessManage').emit('click');await settle();assert.equal(p.located,'https://billing.stripe.com/p/session/1');
 p=await page({respond:api({...base,lifetime:true,active:true,workspaceAccess:true,hasCompany:true})});assert.match(p.node('phBusinessStatus').textContent,/Lifetime Business/);assert.deepEqual([p.node('phBusinessOpen').hidden,p.node('phBusinessManage').hidden,p.node('phBusinessForm').hidden],[false,true,true]);
 p=await page({respond:api({...base,hasCompany:true,subscriptionStatus:'canceled'})});assert.match(p.node('phBusinessStatus').textContent,/has ended/);assert.equal(p.node('phBusinessForm').hidden,true);
 p=await page({respond:api({...base,hasCompany:true,subscriptionStatus:'past_due',canManageBilling:true})});assert.match(p.node('phBusinessStatus').textContent,/needs attention \(past due\)/);assert.equal(p.node('phBusinessManage').hidden,false);
 p=await page({respond:api({...base,eligible:false})});assert.match(p.node('phBusinessStatus').textContent,/team member/);assert.equal(p.node('phBusinessForm').hidden,true);
 p=await page({respond:api({...base,mode:'test'})});assert.match(p.node('phBusinessStatus').textContent,/^TEST MODE/);assert.equal(p.node('phBusinessForm').hidden,false);assert.ok(p.marked.some(e=>e.textContent==='Coming Soon'),'test mode never changes public wording');
 p=await page({respond:api({...base,mode:'test',active:true,hasCompany:true,subscriptionStatus:'active',canManageBilling:true})});assert.equal(p.node('phBusinessOpen').hidden,true,'a test payment does not offer the live workspace');
});
test('returning from checkout polls until the membership is active',async()=>{
 let n=0;const p=await page({search:'?business=success',respond:(path)=>path==='/api/business/status'?[200,++n<3?{...base,hasCompany:true}:{...base,hasCompany:true,active:true,plan:'business',workspaceAccess:true,subscriptionStatus:'active',canManageBilling:true}]:[404,{}]});
 await p.run();assert.ok(n>=3);assert.match(p.node('phBusinessStatus').textContent,/Your Business membership is active/);assert.equal(p.accountTab.clicked,true);
 const c=await page({search:'?business=cancelled',respond:api(base)});assert.match(c.node('phBusinessStatus').textContent,/Checkout closed\. Checking billing status\./);
});

test('account changes cannot reuse displayed billing state or a stale checkout response',async()=>{
 let p=await page({respond:api({...base,hasCompany:true})});p.switchAccount('replacement');
 await p.node('phBusinessForm').emit('submit');await settle();
 assert.equal(p.calls.filter(c=>c.path==='/api/business/checkout').length,0);assert.equal(p.located,null);
 p=await page({respond:path=>{if(path==='/api/business/checkout'){p.switchAccount('replacement');return [200,{url:'https://checkout.stripe.com/pay/stale'}];}return api({...base,hasCompany:true})(path);}});
 await p.node('phBusinessForm').emit('submit');await settle();assert.equal(p.located,null);assert.match(p.node('phBusinessStatus').textContent,/account changed/);
 assert.equal(p.node('phBusinessBuy').disabled,true,'a failed or uncertain attempt requires a fresh status check');
});

test('Stripe-looking URLs with embedded credentials or unexpected ports are rejected',async()=>{
 for(const url of ['https://user:pass@checkout.stripe.com/pay','https://checkout.stripe.com:444/pay']){
  const p=await page({respond:api({...base,hasCompany:true},{'/api/business/checkout':[200,{url}]})});
  await p.node('phBusinessForm').emit('submit');await settle();assert.equal(p.located,null);assert.match(p.node('phBusinessStatus').textContent,/Unexpected/);
 }
});
