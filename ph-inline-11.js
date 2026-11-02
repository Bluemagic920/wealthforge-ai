
(()=>{'use strict';
const $=id=>document.getElementById(id);
const status=$('billCloudStatus');
const getLocal=()=>{try{const key='ph_billing_preview_'+(localStorage.getItem('wealthforge_active_user')||'local');return {key,records:JSON.parse(localStorage.getItem(key)||'[]')}}catch(e){throw Error('Local draft data is invalid: '+e.message)}};
async function getAuth(){
 const sb=window.wealthforgeAuthClient;
 if(!sb)throw Error('Cloud account is unavailable. Sign in under Account first.');
 const {data,error}=await sb.auth.getUser();
 if(error||!data?.user)throw Error('Sign in under Account first.');
 return {sb,user:data.user};
}
function valid(d){return d&&typeof d==='object'&&typeof d.id==='string'&&d.id.length<100&&['Quote','Invoice'].includes(d.type)&&Array.isArray(d.lines)&&d.lines.length<=100&&d.lines.every(x=>typeof x.description==='string'&&x.description.length<=300&&Number.isFinite(x.quantity)&&x.quantity>0&&Number.isFinite(x.price)&&x.price>=0)&&Number.isFinite(d.total)&&d.total>=0&&d.total<=1e9;}
async function run(button,task){button.disabled=true;status.textContent='Working with secure cloud storage…';try{await task()}catch(e){status.textContent='Cloud operation failed: '+e.message}finally{button.disabled=false}}
$('billCloudUpload').onclick=()=>run($('billCloudUpload'),async()=>{
 const {sb,user}=await getAuth(),{records}=getLocal();
 if(!records.length){status.textContent='No local documents to upload.';return;}
 if(records.length>500)throw Error('More than 500 documents: contact support before syncing.');
 if(!records.every(valid))throw Error('A local document has invalid data. No documents were uploaded.');
 const {data:existing,error:fetchError}=await sb.from('ph_billing_documents').select('document_id,document').eq('user_id',user.id);
 if(fetchError)throw fetchError;
 const byId=new Map((existing||[]).map(r=>[r.document_id,r.document]));
 const fresh=records.filter(d=>!byId.has(d.id));
 const changed=records.filter(d=>byId.has(d.id)&&JSON.stringify(byId.get(d.id))!==JSON.stringify(d));
 // Only insert IDs that are absent from cloud. Conflicts never overwrite cloud data.
 // If some existing documents differ, leave them untouched and report them separately.
 if(!fresh.length){status.textContent=changed.length
  ?`No new documents to upload. ${changed.length} existing cloud document(s) differ from local copies; none were changed.`
  :'All local documents already exist in your cloud account.';return;}
 if(!confirm(`Upload ${fresh.length} NEW document(s) to your account? ${changed.length} conflicting existing document(s) will be skipped without changes.`)){
  status.textContent='Upload canceled. No cloud documents changed.';return;
 }
 const payload=fresh.map(d=>({user_id:user.id,document_id:d.id,document:d}));
 // Database primary key must prevent duplicate (user_id, document_id) inserts.
 const {error}=await sb.from('ph_billing_documents').insert(payload);
 if(error)throw error;
 status.textContent=`Uploaded ${fresh.length} new document(s). ${changed.length} conflicting existing document(s) skipped. No existing cloud records overwritten.`;
});
$('billCloudDownload').onclick=()=>run($('billCloudDownload'),async()=>{
 const {sb,user}=await getAuth();
 const {data,error}=await sb.from('ph_billing_documents').select('document_id,document').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1000);
 if(error)throw error;
 const cloud=(data||[]).map(x=>x.document);
 if(!cloud.every(valid))throw Error('One or more cloud documents failed validation. No local data changed.');
 const {key,records}=getLocal();
 // Compare document content regardless of JSON object key order.
 const stable=v=>JSON.stringify(v,(function(){const seen=new WeakSet();return function(k,val){if(val&&typeof val==='object'&&!Array.isArray(val)){if(seen.has(val))return null;seen.add(val);return Object.fromEntries(Object.entries(val).sort(([a],[b])=>a.localeCompare(b)));}return val}})());
 const localById=new Map(records.map(d=>[d.id,d]));
 const conflicts=cloud.filter(d=>localById.has(d.id)&&stable(localById.get(d.id))!==stable(d));
 const fresh=cloud.filter(d=>!localById.has(d.id));
 if(!fresh.length&&!conflicts.length){status.textContent='All cloud documents are already present locally. Click Quotes & Invoices again to refresh the list.';return;}
 let recovery=[];
 if(conflicts.length){
   const want=confirm(`${conflicts.length} cloud document(s) have the same ID as local drafts but different contents.\n\nOK: keep BOTH versions by importing cloud versions as clearly labeled recovery copies.\nCancel: leave conflicts untouched; only import nonconflicting new documents.`);
   if(want)recovery=conflicts.map(d=>({...d,id:crypto.randomUUID(),number:String(d.number||'Document')+' [Cloud recovery copy]',status:'Draft'}));
 }
 if(fresh.length&&!confirm(`Import ${fresh.length} new cloud document(s)? Existing drafts will remain unchanged.`)){status.textContent='Cloud download canceled. No local records changed.';return;}
 const additions=[...fresh,...recovery];
 if(!additions.length){status.textContent=`${conflicts.length} conflict(s) preserved without changes. No new cloud documents to import.`;return;}
 localStorage.setItem(key,JSON.stringify([...additions,...records]));
 status.textContent=`Imported ${fresh.length} new document(s) and ${recovery.length} recovery copy/copies. Existing local drafts preserved. Click Quotes & Invoices again to refresh the list.`;
 // Refresh the existing document list without overwriting the editor.
 document.querySelector('[data-tab="billing"]')?.click();
});
})();
