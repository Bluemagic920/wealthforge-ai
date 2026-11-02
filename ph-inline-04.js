
(()=>{
 const btn=document.getElementById('phSendTestEmail');
 const status=document.getElementById('phEmailTestStatus');
 if(!btn||!status)return;
 btn.addEventListener('click',async()=>{
  if(!window.confirm('Send one test email to the verified email address on your ProfitHarbor AI account?'))return;
  btn.disabled=true;status.textContent='Submitting test email…';
  try{
   const sb=window.wealthforgeAuthClient;
   if(!sb)throw new Error('Sign in under Account first.');
   const {data,error}=await sb.auth.getSession();
   if(error||!data?.session?.access_token)throw new Error('Your session expired. Please sign in again.');
   const response=await fetch('https://wealthforge-ai-api.bluemagic920.workers.dev/api/email-test',{
    method:'POST',headers:{'Authorization':'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:'{}'
   });
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'Email test failed (HTTP '+response.status+').');
   status.textContent='Resend accepted the test for '+(result.recipient||'your account email')+'. Check your inbox and spam folder. Acceptance does not confirm delivery.';
  }catch(err){status.textContent='Test failed: '+(err?.message||'Unknown error');}
  finally{btn.disabled=false;}
 });
})();
