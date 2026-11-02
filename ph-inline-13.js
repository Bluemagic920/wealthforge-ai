
(()=>{'use strict';
 const fieldIds=['sigName','sigTitle','sigCompany','sigPhone','sigWebsite','sigClosing',
 'sigFont','sigSize','sigColor','sigMessage','phSenderMode','phSenderName',
 'phSenderAddress','phReplyTo'];
 const status=document.getElementById('phSettingsCloudStatus');
 const loadButton=document.getElementById('phSettingsLoad');
 if(!status||!loadButton)return;
 let lastUser=null, busy=false, dirty=false, hooked=false, checks=0;
 fieldIds.forEach(id=>{
   const el=document.getElementById(id);
   el?.addEventListener('input',()=>{dirty=true;});
   el?.addEventListener('change',()=>{dirty=true;});
 });
 document.getElementById('phSettingsSave')?.addEventListener('click',()=>{dirty=false;});
 loadButton.addEventListener('click',()=>{dirty=false;});
 async function autoLoad(userId){
   if(!userId||busy||lastUser===userId)return;
   if(dirty){status.textContent='Unsaved edits detected. Save or use Load my saved settings to replace them.';return;}
   busy=true;
   try{
     const sb=window.wealthforgeAuthClient;
     const {data,error}=await sb.from('ph_business_settings')
       .select('settings,logo_path').eq('user_id',userId).maybeSingle();
     if(error)throw error;
     // Only the existing trusted loader applies values and creates the signed logo URL.
     // Avoid reloading if the user started editing while the request was in flight.
     if(dirty)return;
     lastUser=userId;
     if(!data){status.textContent='No saved business settings yet.';return;}
     loadButton.click();
   }catch(e){status.textContent='Automatic load unavailable. Use Load my saved settings. '+e.message;}
   finally{busy=false;}
 }
 async function check(){
   const sb=window.wealthforgeAuthClient;
   if(!sb?.auth?.getSession)return;
   if(!hooked&&typeof sb.auth.onAuthStateChange==='function'){
     hooked=true;
     sb.auth.onAuthStateChange((event,session)=>{
       if(event==='SIGNED_OUT'){lastUser=null;dirty=false;return;}
       if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='USER_UPDATED'){
         // Defer Supabase calls until the auth callback has returned.
         Promise.resolve().then(()=>autoLoad(session?.user?.id));
       }
     });
   }
   try{
     const {data,error}=await sb.auth.getSession();
     if(!error&&data?.session?.user?.id)await autoLoad(data.session.user.id);
   }catch{}
 }
 const interval=setInterval(()=>{check();if(++checks>=60)clearInterval(interval);},500);
 check();
})();
