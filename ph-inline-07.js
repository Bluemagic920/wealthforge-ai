
(()=>{'use strict';
 const $=id=>document.getElementById(id), status=$('phSettingsCloudStatus');
 const ids=['sigName','sigTitle','sigCompany','sigPhone','sigWebsite','sigClosing','sigFont','sigSize','sigColor','sigMessage','phSenderMode','phSenderName','phSenderAddress','phReplyTo'];
 const bucket='ph-company-logos';
 let signedUrl=null;
 const client=async()=>{
  const sb=window.wealthforgeAuthClient;
  if(!sb)throw Error('Cloud library unavailable. Sign in under Account.');
  const {data,error}=await sb.auth.getUser();
  if(error||!data?.user)throw Error('Please sign in under Account first.');
  return {sb,user:data.user};
 };
 const showLogo=async(sb,path)=>{
  const holder=$('phStoredLogo');holder.classList.add('hidden');
  if(!path)return;
  const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,3600);
  if(error)throw error;
  signedUrl=data.signedUrl;$('phStoredLogoImage').src=signedUrl;holder.classList.remove('hidden');
 };
 const fields=()=>Object.fromEntries(ids.map(id=>[id,$(id).value]));
 const setFields=data=>{ids.forEach(id=>{if(typeof data?.[id]==='string'){
   const control=$(id);
   if(control.tagName==='SELECT'&&!Array.from(control.options).some(x=>x.value===data[id]))return;
   control.value=data[id];control.dispatchEvent(new Event('input',{bubbles:true}));
 }})};
 async function optimize(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Logo must be PNG, JPG or WebP, maximum 5 MB.');
  const image=await createImageBitmap(file);
  try{
   const scale=Math.min(1,600/image.width,240/image.height);
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!blob)throw Error('Could not process logo.');
   if(blob.size>1024*1024)throw Error('Optimized logo exceeds 1 MB. Please choose a simpler image.');
   return blob;
  }finally{image.close();}
 }
 $('phSettingsLoad').addEventListener('click',async()=>{
  status.textContent='Loading saved settings…';
  try{
   const {sb,user}=await client();
   const {data,error}=await sb.from('ph_business_settings').select('settings,logo_path').eq('user_id',user.id).maybeSingle();
   if(error)throw error;
   if(!data){status.textContent='No saved business settings yet.';return;}
   setFields(data.settings);await showLogo(sb,data.logo_path);
   status.textContent='Saved business settings loaded for your account.';
  }catch(e){status.textContent='Load failed: '+e.message;}
 });
 $('phSettingsSave').addEventListener('click',async()=>{
  const button=$('phSettingsSave');button.disabled=true;status.textContent='Saving your settings securely…';
  try{
   const {sb,user}=await client();
   const {data:prior,error:readError}=await sb.from('ph_business_settings').select('logo_path').eq('user_id',user.id).maybeSingle();
   if(readError)throw readError;
   let path=prior?.logo_path||null;
   const file=$('sigLogo').files?.[0];
   if(file){
    const blob=await optimize(file);
    const nextPath=user.id+'/company-logo-'+crypto.randomUUID()+'.png';
    const {error:uploadError}=await sb.storage.from(bucket).upload(nextPath,blob,{contentType:'image/png',upsert:false});
    if(uploadError)throw uploadError;
    path=nextPath;
   }
   const {error}=await sb.from('ph_business_settings').upsert({user_id:user.id,settings:fields(),logo_path:path},{onConflict:'user_id'});
   if(error)throw error;
   await showLogo(sb,path);
   status.textContent='Settings saved securely. Outgoing email signatures are not enabled in this stage.';
  }catch(e){status.textContent='Save failed: '+e.message;}
  finally{button.disabled=false;}
 });
})();
