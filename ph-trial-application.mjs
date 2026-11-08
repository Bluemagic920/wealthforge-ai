// Qualification intake only. This module never grants access or starts a subscription.
function clean(value,max){if(typeof value!=='string'||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw Error('Please check the application fields.');return value.trim();}
export function buildTrialInquiry(values){
 const name=clean(values.name,120),email=clean(values.email,254),company=clean(values.company,120),industry=clean(values.industry,80),profile=clean(values.profile,250),goal=clean(values.goal,500);
 if(!name||!company||!industry||!/^\S+@\S+\.\S+$/.test(email)||goal.length<30)throw Error('Add your business details and describe your trial goal in at least 30 characters.');
 if(profile){let url;try{url=new URL(profile);}catch{throw Error('Use a complete business website or profile URL, or leave it blank.');}if(!['http:','https:'].includes(url.protocol))throw Error('Use an http or https business profile URL.');}
 const roles={'owner':'Owner / co-owner','decision-maker':'Authorized purchase decision-maker'};
 const team={'solo':'Just me','2-5':'2–5 people','6-20':'6–20 people','21+':'21+ people'};
 const timing={'30-days':'Within 30 days, if it meets my needs','90-days':'Within 1–3 months, if it meets my needs','evaluating':'Still evaluating my budget and timing'};
 if(!roles[values.role]||!team[values.team]||!timing[values.timing]||values.operating!==true||values.price!==true||values.contact!==true)throw Error('Confirm your role, active business, pricing awareness, and permission to reply about this application.');
 const message=['PRO_TRIAL_APPLICATION_V1','Request: 30-day ProfitHarbor AI Pro trial; approval required.',`Role: ${roles[values.role]}`,`Industry: ${industry}`,`Team: ${team[values.team]}`,`Business website/profile: ${profile||'Not provided; manual verification needed'}`,`Trial goal: ${goal}`,`Purchase timing: ${timing[values.timing]}`,'Applicant confirms an active small business and understands Pro is $29.99/month after the trial only if separately purchased; no automatic charge.',`Optional end-of-trial feedback email consent: ${values.feedback===true?'YES':'NO'}`,'Trial access has not been granted. Review business eligibility before approval.'].join('\n');
 if(message.length>2000)throw Error('Please shorten your application details.');
 return {full_name:name,email,company,message,inquiry_contact_consent:true,marketing_consent:false};
}
export function setupTrialApplication(){
 const form=document.getElementById('phTrialApplication'),status=document.getElementById('phTrialStatus'),inquiry=document.getElementById('phSalesInquiry');if(!form||!status||!inquiry)return;
 form.addEventListener('submit',event=>{
  event.preventDefault();
  try{
   const fields=new FormData(form),values=Object.fromEntries(fields);
   for(const name of ['operating','price','contact','feedback'])values[name]=fields.get(name)==='on';
   const result=buildTrialInquiry(values);
   for(const name of ['full_name','email','company','message'])inquiry.elements.namedItem(name).value=result[name];
   inquiry.elements.namedItem('inquiry_consent').checked=true;
   inquiry.elements.namedItem('marketing_consent').checked=false;
   document.getElementById('phSalesFeedback').textContent='Trial application prepared, not submitted. Review the details, complete security verification, then choose Send inquiry. Trial access requires separate approval and activation.';
   status.textContent='Your application is ready to review in the inquiry form below. It has not been sent and no trial has started.';
   inquiry.scrollIntoView({behavior:'smooth',block:'start'});inquiry.elements.namedItem('message').focus({preventScroll:true});
  }catch(error){status.textContent=error.message;}
 });
}
if(typeof document!=='undefined')setupTrialApplication();
