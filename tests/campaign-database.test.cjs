const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),cp=require('node:child_process');
const OWNER='11111111-1111-4111-8111-111111111111',ORG='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
test('campaign activation database gate and revision fencing',async t=>{
 const bin=process.env.PH_PG_BIN||(process.platform==='win32'?'C:/Program Files/PostgreSQL/17/bin':'/usr/lib/postgresql/17/bin'),root=path.join(process.env.TEMP||process.env.TMPDIR||require('node:os').tmpdir(),'ph-campaign-db-tests');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'invitations-')),data=path.join(dir,'data');
 const env={...process.env,TEMP:dir,TMP:dir};for(const key of Object.keys(env))if(key.startsWith('PG'))delete env[key];
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
 const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','ironcrest_test','-d','postgres'];
 function command(name,args){const fd=fs.openSync(path.join(dir,name+'.log'),'a');try{const r=cp.spawnSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{env,windowsHide:true,encoding:'utf8',timeout:60000,stdio:['ignore',fd,fd]});if(r.error||r.status!==0)throw Error(r.error?.message||fs.readFileSync(path.join(dir,name+'.log'),'utf8')+(fs.existsSync(path.join(dir,'server.log'))?'\n'+fs.readFileSync(path.join(dir,'server.log'),'utf8'):''));return r.stdout;}finally{fs.closeSync(fd);}}
 function sql(text,role='service_role',success=true){const r=cp.spawnSync(path.join(bin,'psql'+(process.platform==='win32'?'.exe':'')),args,{input:(role?"SET ROLE "+role+";SET request.jwt.claim.role='"+role+"';\n":'')+text,env,windowsHide:true,encoding:'utf8',timeout:30000});if(r.error||success&&r.status!==0)throw Error(r.error?.message||r.stderr);return r;}

 let started=false;
 try{
  command('initdb',['-D',data,'-U','ironcrest_test','-A','trust','--no-locale','-E','UTF8']);
  command('pg_ctl',['-D',data,'-l',path.join(dir,'server.log'),'-o','-h 127.0.0.1 -p '+port+(process.platform==='win32'?'':' -k '+dir),'-w','start']);started=true;
  sql(`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;
  CREATE TABLE public.ph_lead_campaigns(id uuid primary key,user_id uuid,name text,source text,status text,updated_at timestamptz default now());
  GRANT SELECT,INSERT,UPDATE ON public.ph_lead_campaigns TO authenticated,service_role;
  INSERT INTO public.ph_lead_campaigns(id,user_id,name,source,status) VALUES ('${ORG}','${OWNER}','ZEUS ONE','facebook','draft');`,null);
  const before=sql('select row_to_json(c) from public.ph_lead_campaigns c;',null).stdout.trim();
  sql(fs.readFileSync('docs/campaign-activation-guard.sql','utf8'),null);
  assert.equal(sql('select row_to_json(c) from public.ph_lead_campaigns c;',null).stdout.trim(),before,'install preserves all existing records');
  assert.notEqual(sql(`update public.ph_lead_campaigns set status='active' where id='${ORG}';`,'authenticated',false).status,0);
  assert.notEqual(sql(`insert into public.ph_lead_campaigns(id,status) values ('${OTHER}','active');`,'authenticated',false).status,0);
  const revision=sql(`select updated_at from public.ph_lead_campaigns where id='${ORG}';`,null).stdout.trim();
  sql(`update public.ph_lead_campaigns set status='active' where id='${ORG}' and user_id='${OWNER}' and status='draft' and updated_at='${revision}';`);
  assert.equal(sql(`select status from public.ph_lead_campaigns where id='${ORG}';`,null).stdout.trim(),'active');
  assert.notEqual(sql(`select updated_at from public.ph_lead_campaigns where id='${ORG}';`,null).stdout.trim(),revision);
  assert.equal(sql(`with changed as(update public.ph_lead_campaigns set status='paused' where id='${ORG}' and updated_at='${revision}' returning id) select count(*) from changed;`).stdout.trim(),'0','stale revision cannot modify campaign');
  sql(`update public.ph_lead_campaigns set name='New name' where id='${ORG}';`,'authenticated');
  sql(`update public.ph_lead_campaigns set status='paused' where id='${ORG}';`,'authenticated');
  assert.notEqual(sql(`update public.ph_lead_campaigns set status='active' where id='${ORG}';`,'authenticated',false).status,0);
  sql(`update public.ph_lead_campaigns set status='archived' where id='${ORG}';`,'authenticated');
 }finally{if(started)command('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
});
