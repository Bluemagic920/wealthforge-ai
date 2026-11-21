const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),cp=require('node:child_process'),os=require('node:os');
const U={life:'11111111-1111-4111-8111-111111111111',legacy:'22222222-2222-4222-8222-222222222222',buyer:'33333333-3333-4333-8333-333333333333',employee:'44444444-4444-4444-8444-444444444444',fresh:'55555555-5555-4555-8555-555555555555'};
const O={life:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',legacy:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
test('Business checkout onboarding and live entitlement bridge',async t=>{
 let bin=process.env.PH_PG_BIN;if(!bin){try{bin=cp.execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();}catch{}}
 const exe=name=>name+(process.platform==='win32'?'.exe':'');
 if(!bin&&process.platform==='win32')bin='C:/Program Files/PostgreSQL/17/bin';
 if(!bin||!fs.existsSync(path.join(bin,exe('initdb')))){t.skip('PostgreSQL server binaries not available');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ph-business-')),data=path.join(dir,'data');
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key];
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const run=(name,args)=>{const log=fs.openSync(path.join(dir,name+'.log'),'a');let r;try{r=cp.spawnSync(path.join(bin,exe(name)),args,{env,windowsHide:true,stdio:['ignore',log,log],timeout:120000});}finally{fs.closeSync(log);}if(r.status!==0)throw Error(name+' failed: '+fs.readFileSync(path.join(dir,name+'.log'),'utf8'));};
 const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','ph_test','-d','postgres'];
 function sql(text,role='service_role',ok=true){const r=cp.spawnSync(path.join(bin,'psql'),args,{env,input:(role?'set role '+role+';\n':'')+text,encoding:'utf8',timeout:60000});if(ok&&r.status!==0)throw Error(r.stderr);return r;}
 const one=(text,role)=>sql(text,role).stdout.trim();
 const call=(user,op,data={},mode='live')=>JSON.parse(one(`select public.ironcrest_business_checkout('${mode}','${user}','${op}','${JSON.stringify(data).replaceAll("'","''")}'::jsonb);`));
 const fails=(user,op,data={},mode='live',role='service_role')=>sql(`select public.ironcrest_business_checkout('${mode}','${user}','${op}','${JSON.stringify(data).replaceAll("'","''")}'::jsonb);`,role,false);
 const entitlement=org=>one(`select row_to_json(e) from public.ironcrest_business_entitlement('${org}') e;`);
 let started=false;
 try{
  run('initdb',['-D',data,'-U','ph_test','-A','trust','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o','-h 127.0.0.1 -p '+port+(process.platform==='win32'?'':' -k '+dir),'-w','start']);started=true;
  sql(fs.readFileSync(path.join(__dirname,'helpers','business-schema.sql'),'utf8'),null);
  sql(`insert into auth.users(id) values ${Object.values(U).map(x=>`('${x}')`).join(',')};
   insert into public.ironcrest_organizations(id,name,created_by) values ('${O.life}','Lifetime Co','${U.life}'),('${O.legacy}','Legacy Co','${U.legacy}');
   insert into public.ironcrest_memberships(organization_id,user_id,role) values ('${O.life}','${U.life}','owner'),('${O.legacy}','${U.legacy}','owner'),('${O.life}','${U.employee}','employee');
   insert into public.owner_entitlements(user_id,lifetime_business) values ('${U.life}',true);
   insert into public.ironcrest_stripe_price_mapping values ('price_legacy','business'),('price_addon','unlimited_employees');
   insert into public.ph_subscriptions_live(user_id,stripe_price_id,status,current_period_end) values ('${U.legacy}','price_legacy','active',now()+interval '10 days');
   insert into public.ironcrest_addon_subscriptions(organization_id,stripe_subscription_id,stripe_price_id,status,current_period_end) values ('${O.legacy}','sub_addon','price_addon','active',now()+interval '10 days');`,null);
  const before={life:entitlement(O.life),legacy:entitlement(O.legacy)};
  const rows=one(`select (select count(*) from public.ironcrest_organizations)||','||(select count(*) from public.ironcrest_memberships);`,null);
  sql(fs.readFileSync(path.join(__dirname,'..','docs','business-checkout.sql'),'utf8'),null);
  sql(fs.readFileSync(path.join(__dirname,'..','docs','business-checkout.sql'),'utf8'),null); // re-runnable
  assert.equal(one(`select (select count(*) from public.ironcrest_organizations)||','||(select count(*) from public.ironcrest_memberships);`,null),rows,'install changes no rows');
  assert.equal(entitlement(O.life),before.life,'lifetime result preserved');
  assert.equal(entitlement(O.legacy),before.legacy,'legacy subscription result preserved');
  assert.match(before.life,/LIFETIME_BUSINESS/);assert.match(before.legacy,/BUSINESS_UNLIMITED/);

  for(const role of ['anon','authenticated'])assert.notEqual(fails(U.buyer,'status',{},'live',role).status,0,role+' cannot call checkout function');
  assert.notEqual(fails(U.buyer,'status',{},'prod').status,0);assert.notEqual(fails(U.buyer,'delete').status,0);
  assert.notEqual(fails('99999999-9999-4999-8999-999999999999','prepare',{companyName:'Ghost Co'}).status,0,'unknown account cannot create a company');
  assert.equal(one(`select count(*) from public.ironcrest_organizations where name='Ghost Co';`,null),'0');

  let s=call(U.buyer,'status');
  assert.deepEqual([s.hasCompany,s.eligible,s.customerId,s.subscriptionActive,s.lifetimeBusiness],[false,true,null,false,false]);
  assert.equal(one(`select count(*) from public.ironcrest_organizations where created_by='${U.buyer}';`,null),'0','status creates nothing');
  for(const companyName of ['','   ','x'.repeat(121),'Bad\u0007Name'])assert.notEqual(fails(U.buyer,'prepare',{companyName}).status,0,'invalid name rejected');
  assert.notEqual(fails(U.buyer,'customer',{customerId:'cus_A1'}).status,0,'customer needs a company');
  s=call(U.buyer,'prepare',{companyName:"  Riley's Roofing  "});
  assert.equal(s.hasCompany,true);const org=s.organizationId;
  assert.equal(one(`select name||'|'||(select role||active from public.ironcrest_memberships where organization_id=o.id and user_id='${U.buyer}')||'|'||(select count(*) from public.ironcrest_company_settings where organization_id=o.id)||(select count(*) from public.ironcrest_settings where organization_id=o.id) from public.ironcrest_organizations o where id='${org}';`,null),"Riley's Roofing|ownertrue|11");
  assert.equal(call(U.buyer,'prepare',{companyName:'Other Name'}).organizationId,org,'prepare is idempotent');
  assert.equal(one(`select count(*)||name from public.ironcrest_organizations where created_by='${U.buyer}' group by name;`,null),"1Riley's Roofing");
  assert.notEqual(fails(U.buyer,'customer',{customerId:'sub_wrong'}).status,0);
  assert.equal(call(U.buyer,'customer',{customerId:'cus_Live1'}).customerId,'cus_Live1');
  assert.equal(call(U.buyer,'customer',{customerId:'cus_Live1'}).customerId,'cus_Live1','same customer is idempotent');
  assert.notEqual(fails(U.buyer,'customer',{customerId:'cus_Other'}).status,0,'mapping cannot be replaced');
  sql(fs.readFileSync(path.join(__dirname,'..','docs','business-checkout-attempts.sql'),'utf8'),null);
  sql(fs.readFileSync(path.join(__dirname,'..','docs','business-checkout-attempts.sql'),'utf8'),null);
  const attempt=(op,data={},role='service_role',ok=true)=>sql(`select public.ironcrest_business_checkout_attempt('live','${U.buyer}','${op}','${JSON.stringify(data).replaceAll("'","''")}'::jsonb);`,role,ok);
  const reserve={interval:'month',origin:'https://profitharborai.com'};
  const a=JSON.parse(attempt('reserve',reserve).stdout);
  const a2=JSON.parse(attempt('reserve',{...reserve,interval:'year'}).stdout);
  assert.equal(a.attemptId,a2.attemptId,'monthly and annual share one durable reservation');assert.equal(a2.interval,'month');
  for(const role of ['anon','authenticated']){
   assert.notEqual(attempt('reserve',reserve,role,false).status,0);
   assert.notEqual(sql('select * from public.ironcrest_business_checkout_attempts;',role,false).status,0);
  }
  assert.notEqual(attempt('record',{attemptId:a.attemptId,sessionId:'sub_wrong'},'service_role',false).status,0);
  attempt('record',{attemptId:a.attemptId,sessionId:'cs_test_One'});
  assert.notEqual(attempt('record',{attemptId:a.attemptId,sessionId:'cs_test_Other'},'service_role',false).status,0);
  assert.notEqual(attempt('expired',{attemptId:a.attemptId,sessionId:'cs_test_Other',...reserve},'service_role',false).status,0);
  const renewed=JSON.parse(attempt('expired',{attemptId:a.attemptId,sessionId:'cs_test_One',...reserve,interval:'year'}).stdout);
  assert.notEqual(renewed.attemptId,a.attemptId);assert.equal(renewed.interval,'year');assert.equal(renewed.sessionId,null);
  sql(`update public.ironcrest_billing_customers set review_required=true where customer_id='cus_Live1';`,null);
  assert.notEqual(attempt('reserve',reserve,'service_role',false).status,0,'risk hold blocks a reservation');
  sql(`update public.ironcrest_billing_customers set review_required=false where customer_id='cus_Live1';`,null);
  assert.equal(call(U.buyer,'customer',{customerId:'cus_Test1'},'test').customerId,'cus_Test1','test and live are separate');

  // Employees and ambiguous accounts cannot start a second company.
  s=call(U.employee,'status');assert.deepEqual([s.hasCompany,s.eligible],[false,false]);
  assert.notEqual(fails(U.employee,'prepare',{companyName:'Side Co'}).status,0);
  assert.equal(one(`select count(*) from public.ironcrest_organizations where created_by='${U.employee}';`,null),'0');
  // Lifetime owner: existing company is recognised and reported.
  s=call(U.life,'prepare',{companyName:'Ignored'});assert.deepEqual([s.organizationId,s.lifetimeBusiness],[O.life,true]);
  assert.equal(one(`select count(*) from public.ironcrest_organizations where created_by='${U.life}';`,null),'1');

  // Entitlement bridge.
  assert.match(entitlement(org),/"business_active":false.*NO_BUSINESS_ACCESS/);
  const snap=(mode,customer,type,active,status,end,limit,unlimited=false)=>sql(`insert into public.ironcrest_billing_snapshots(mode,customer_id,subscription_id,subscription_type,status,business_active,unlimited_employees,employee_limit,current_period_end,cancel_at_period_end)
   values('${mode}','${customer}','sub_${type==='business'?'B':'U'}${mode}','${type}','${status}',${active},${unlimited},${limit},now()+interval '${end}',false)
   on conflict(mode,customer_id,subscription_type) do update set status=excluded.status,business_active=excluded.business_active,unlimited_employees=excluded.unlimited_employees,employee_limit=excluded.employee_limit,current_period_end=excluded.current_period_end;`,null);
  snap('test','cus_Test1','business',true,'active','30 days',20);
  assert.match(entitlement(org),/NO_BUSINESS_ACCESS/,'test-mode payment never grants live access');
  assert.equal(call(U.buyer,'status',{},'test').subscriptionActive,true);assert.equal(call(U.buyer,'status').subscriptionActive,false);
  snap('live','cus_Live1','business',true,'active','30 days',20);
  assert.equal(entitlement(org),'{"business_active":true,"unlimited_employees":false,"employee_limit":20,"entitlement_status":"BUSINESS_20"}');
  s=call(U.buyer,'status');assert.deepEqual([s.subscriptionActive,s.subscriptionStatus,s.employeeLimit],[true,'active',20]);
  snap('live','cus_Live1','unlimited_employees',false,'active','30 days',0,true);
  assert.equal(entitlement(org),'{"business_active":true,"unlimited_employees":true,"employee_limit":null,"entitlement_status":"BUSINESS_UNLIMITED"}');
  sql(`delete from public.ironcrest_billing_snapshots where subscription_type='unlimited_employees';update public.ironcrest_billing_customers set review_required=true where customer_id='cus_Live1';`,null);
  assert.match(entitlement(org),/NO_BUSINESS_ACCESS/,'risk review suspends access');assert.equal(call(U.buyer,'status').subscriptionActive,false);
  sql(`update public.ironcrest_billing_customers set review_required=false where customer_id='cus_Live1';`,null);
  for(const [active,status,end] of [[false,'past_due','30 days'],[false,'canceled','30 days'],[true,'active','-1 minute']]){snap('live','cus_Live1','business',active,status,end,active?20:0);assert.match(entitlement(org),/NO_BUSINESS_ACCESS/,status+' '+end+' denies access');}
  snap('live','cus_Live1','business',true,'active','30 days',20);assert.match(entitlement(org),/BUSINESS_20/);
  sql(`update public.ironcrest_memberships set active=false where organization_id='${org}';`,null);
  assert.match(entitlement(org),/NO_BUSINESS_ACCESS/,'inactive owner denies access');
  assert.equal(entitlement(O.life),before.life);assert.equal(entitlement(O.legacy),before.legacy);
 }finally{if(started)try{run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});
