(()=>{'use strict';
const URL='https://nhiqbcevcdxfzvrprgck.supabase.co';
const KEY='sb_publishable_VwM3o7h2Jxq9_2WkkdE4kg_WKU6bvP6';
const $=id=>document.getElementById(id);
const status=msg=>{$('cloudStatus').textContent=msg};
if(!window.supabase){status('Cloud library unavailable. Check internet access.');return}
const sb=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const groups=['customers','drafts','workflows','assets','goals','cash'];
const types={customers:'customer',drafts:'draft',workflows:'workflow',assets:'asset',goals:'goal',cash:'cash'};
const reverse=Object.fromEntries(Object.entries(types).map(([k,v])=>[v,k]));
const blank=()=>Object.fromEntries(groups.map(g=>[g,[]]));
let user=null,ready=false,busy=false,pending=false,delay=null,epoch=0,conflictLocked=false;
const scoped=id=>'wealthforge_user_'+id;
const baselineKey=id=>'wealthforge_baseline_v142_'+id;
const fingerprint=x=>JSON.stringify(x);
const baselineOf=rows=>Object.fromEntries(rows.map(r=>[r.record_type+'|'+r.payload.id,fingerprint(r.payload)]));
const readBaseline=id=>{try{return JSON.parse(localStorage.getItem(baselineKey(id))||'{}')}catch{return {}}};
const saveBaseline=(id,rows)=>localStorage.setItem(baselineKey(id),JSON.stringify(baselineOf(rows)));
let recoveryRows=null;
function valid(d){return d&&groups.every(g=>Array.isArray(d[g]))}
function local(id){try{const d=JSON.parse(localStorage.getItem(scoped(id))||'null');return valid(d)?d:blank()}catch{return blank()}}
function setUI(u){user=u;$('signedOut').classList.toggle('hidden',!!u);$('signedIn').classList.toggle('hidden',!u);$('cloudEmail').textContent=u?.email||''}
async function fetchRows(id){
 const {data,error}=await sb.from('wealthforge_records').select('id,record_type,payload,updated_at').eq('user_id',id).limit(1001);
 if(error)throw error;if(data.length>1000)throw Error('More than 1000 records; automatic sync paused.');
 for(const r of data)if(!reverse[r.record_type]||!r.payload||typeof r.payload!=='object'||Array.isArray(r.payload)||typeof r.payload.id!=='string')throw Error('Unexpected cloud record; sync paused.');
 return data;
}
function merged(id,rows){
 const result=local(id),baseline=readBaseline(id);let needsSync=false;recoveryRows=null;
 const cloudKeys=new Set(rows.map(r=>r.record_type+'|'+r.payload.id));
 for(const g of groups){result[g]=result[g].filter(item=>{const key=types[g]+'|'+item.id;if(!(key in baseline)||cloudKeys.has(key))return true;if(fingerprint(item)===baseline[key])return false;throw Error('Cloud record was deleted while a local edit exists; export a backup and resolve on one device.');});}
 for(const r of rows){
  const group=reverse[r.record_type],key=r.record_type+'|'+r.payload.id;
  const index=result[group].findIndex(x=>x.id===r.payload.id);
  if(index<0){result[group].push(r.payload);continue}
  const l=fingerprint(result[group][index]),c=fingerprint(r.payload),b=baseline[key];
  if(l===c)continue;
  if(b===c){needsSync=true;continue} // local-only change: preserve and sync
  if(b===l){result[group][index]=r.payload;continue} // remote-only change
  recoveryRows=recoveryRows||[];recoveryRows.push(r); // unknown or concurrent change: require explicit recovery
 }
 if(recoveryRows)throw Error('Local/cloud conflict on customers. Your local edit is preserved. Use Review local changes below after exporting a backup.');
 return {result,needsSync};
}
async function activate(u){
 const token=++epoch;ready=false;pending=false;clearTimeout(delay);
 if(!u){setUI(null);localStorage.removeItem('wealthforge_active_user');status('Signed out. Local prototype data is separate.');if(localStorage.getItem('wealthforge_loaded_user')){localStorage.removeItem('wealthforge_loaded_user');location.reload()}return}
 setUI(u);status('Loading account cloud records…');
 try{
 const rows=await fetchRows(u.id);if(token!==epoch)return;
 const {result,needsSync}=merged(u.id,rows);
 localStorage.setItem(scoped(u.id),JSON.stringify(result));
 localStorage.setItem('wealthforge_active_user',u.id);
 saveBaseline(u.id,rows);
 ready=true;
 status('Cloud ready: '+rows.length+' record(s). Changes auto-save; deletions synchronize with conflict checks.');
 if(localStorage.getItem('wealthforge_loaded_user')!==u.id){localStorage.setItem('wealthforge_loaded_user',u.id);location.reload();return}
 if(needsSync&&!conflictLocked)schedule();
 // If another tab changed the account data, reload the dashboard to show it.
 }catch(e){ready=false;conflictLocked=true;status('Sync paused: '+e.message)}
}
async function refresh(){const {data,error}=await sb.auth.getUser();if(error&&error.name!=='AuthSessionMissingError')status(error.message);await activate(data?.user||null)}
sb.auth.onAuthStateChange((_event,session)=>{const id=session?.user?.id||null;if(id!==(user?.id||null))setTimeout(()=>activate(session?.user||null),0)});
refresh();
function credentials(){const email=$('authEmail').value.trim(),password=$('authPassword').value;if(!email||!password)throw Error('Enter email and password.');return {email,password}}
$('signUp').onclick=async()=>{try{const c=credentials();if(c.password.length<12)throw Error('Use at least 12 characters.');const {data,error}=await sb.auth.signUp(c);if(error)throw error;status(data.session?'Account created.':'Check your email for a confirmation link.')}catch(e){status('Registration: '+e.message)}};
$('signIn').onclick=async()=>{try{const {error}=await sb.auth.signInWithPassword(credentials());if(error)throw error;await refresh()}catch(e){status('Sign in: '+e.message)}};
$('signOut').onclick=async()=>{const {error}=await sb.auth.signOut();if(error)status(error.message);else await activate(null)};
$('resetPassword').onclick=async()=>{try{const email=$('authEmail').value.trim();if(!email)throw Error('Enter your email first.');const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;status('If an account exists, a reset email may arrive.')}catch(e){status(e.message)}};
async function sync(){
 if(!user||!ready||conflictLocked)return; if(busy){pending=true;return}
 busy=true;const id=user.id;const token=epoch;
 try{
 const d=local(id);if(!valid(d))throw Error('Invalid account data');
 const rows=await fetchRows(id);if(token!==epoch)return;
 const existing=new Map(rows.map(r=>[r.record_type+'|'+r.payload.id,r]));
 const updates=[],adds=[],deletes=[];
 const baseline=readBaseline(id);
 const localKeys=new Set(groups.flatMap(g=>d[g].map(item=>types[g]+'|'+item.id)));
 for(const [key,old] of existing){
  if(localKeys.has(key)||!(key in baseline))continue;
  if(baseline[key]!==fingerprint(old.payload))throw Error('Cloud record changed before deletion; sync paused');
  deletes.push(old);
 }
 for(const g of groups)for(const item of d[g]){
 if(!item||typeof item.id!=='string'||!item.id)throw Error('Invalid '+g+' item');
 const key=types[g]+'|'+item.id,old=existing.get(key);
 if(old){
  if(JSON.stringify(old.payload)!==JSON.stringify(item)){
   if(baseline[key]!==JSON.stringify(old.payload))throw Error('Concurrent change detected; sync paused to protect cloud data');
   updates.push({id:old.id,payload:item,updated_at:old.updated_at});
  }
 }else adds.push({user_id:id,record_type:types[g],payload:item});
 }
 if(rows.length+adds.length>1000)throw Error('Record limit exceeded');
 for(const row of adds){const {error}=await sb.from('wealthforge_records').insert(row);if(error)throw error}
 for(const row of updates){const {data,error}=await sb.from('wealthforge_records').update({payload:row.payload,updated_at:new Date().toISOString()}).eq('id',row.id).eq('user_id',id).eq('updated_at',row.updated_at).select('id');if(error)throw error;if(data.length!==1)throw Error('Cloud changed during update; stopped to protect data') }
 for(const row of deletes){const {data,error}=await sb.from('wealthforge_records').delete().eq('id',row.id).eq('user_id',id).eq('updated_at',row.updated_at).select('id');if(error)throw error;if(data.length!==1)throw Error('Cloud changed during deletion; stopped to protect data')}
 const after=await fetchRows(id);
 saveBaseline(id,after);
 status('Auto-synced: '+adds.length+' added, '+updates.length+' updated, '+deletes.length+' deleted.');
 }catch(e){ready=false;conflictLocked=true;status('Auto-sync paused: '+e.message+'. Export a backup; use Keep Cloud Version to resolve.')}
 finally{busy=false;if(pending&&ready){pending=false;sync()}}
}
function schedule(){if(!ready)return;clearTimeout(delay);delay=setTimeout(sync,900)}
window.addEventListener('wealthforge:changed',schedule);
// Deliberately omit legacy 'Review local changes' overwrite: use backup and Keep Cloud Version.
$('cloudUpload').textContent='Sync changes now';
$('cloudUpload').onclick=()=>{if(!ready||conflictLocked)return status('Sync is paused. Export a backup, then use Keep Cloud Version.');sync()};
$('cloudDownload').textContent='Refresh from cloud';
$('cloudDownload').onclick=async()=>{
 if(!user)return status('Sign in first.');
 if(conflictLocked)return status('Sync remains paused. Export a backup, then choose Keep Cloud Version.');
 try{const rows=await fetchRows(user.id),{result,needsSync}=merged(user.id,rows);
 localStorage.setItem(scoped(user.id),JSON.stringify(result));
 saveBaseline(user.id,rows);
 status('Cloud refreshed. Reloading…');location.reload()
 }catch(e){status('Refresh stopped: '+e.message)}
};

// Explicit recovery: discard the stale local snapshot and replace it with the
// complete current cloud snapshot. Never merge or auto-upload during recovery.
const cloudBackup=document.createElement('button');
cloudBackup.textContent='Export JSON backup';
$('cloudDownload').parentElement.appendChild(cloudBackup);
cloudBackup.onclick=()=>document.getElementById('export').click();
const keepCloud=document.createElement('button');
keepCloud.textContent='Keep Cloud Version (discard local changes)';
keepCloud.style.marginLeft='8px';
$('cloudDownload').parentElement.appendChild(keepCloud);
keepCloud.onclick=async()=>{
 if(!user)return status('Sign in first.');
 if(!confirm('Have you exported a JSON backup? This will DISCARD unsynced local changes and load the current cloud records.'))return;
 const id=user.id;
 ready=false;conflictLocked=true;clearTimeout(delay);pending=false;
 const token=++epoch;
 try{
  const rows=await fetchRows(id);
  if(token!==epoch)return;
  const result=blank();
  for(const r of rows)result[reverse[r.record_type]].push(r.payload);
  localStorage.setItem(scoped(id),JSON.stringify(result));
  saveBaseline(id,rows);
  recoveryRows=null;
  status('Cloud version restored. Reloading without uploading local edits…');
  location.reload();
 }catch(e){status('Cloud recovery failed: '+e.message+'. Synchronization remains paused.')}
};

})();
