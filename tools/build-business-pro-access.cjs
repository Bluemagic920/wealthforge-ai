// Adds Business reads to the inspected c4e122c3 live Worker without replacing its
// existing Pro checkout, webhook, portal, AI limits or subscription writer.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
function build(baseline){
 const source=baseline.replace(/\r\n/g,'\n');
 if(crypto.createHash('sha256').update(source).digest('hex')!=='87346e7f192534b5414113fc5e432fca8b9f6f411a7de713815aa5dd5e5544f9')throw Error('Live Worker baseline changed; inspect it before rebuilding');
 const helper=fs.readFileSync(path.join(__dirname,'..','worker','business-pro-access.mjs'),'utf8').replace('export async function','async function');
 const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('Unexpected membership call site');return to;};
 const status="  let row,isOwner;try{isOwner=await phOwnerEntitlement(env,user.id);row=isOwner?null:await phSubscriptionRow(env,user.id)}catch{return json({error:'Membership lookup unavailable'},503,origin)}";
 const statusNew=status+"\n  let business;try{business=isOwner||(row?.stripe_price_id===PH_PRICE_ID&&['active','trialing'].includes(row?.status))?null:await businessProAccess(env,user.id)}catch{return json({error:'Membership lookup unavailable'},503,origin)}\n  if(business && path==='/api/billing/status'&&request.method==='GET')return json({plan:'pro',status:'active',business:true,lifetime_pro:false,cancel_at_period_end:business.cancelAtPeriodEnd,current_period_end:business.currentPeriodEnd},200,origin);\n  if(business && path==='/api/stripe-checkout')return json({error:'Business already includes Pro. No additional subscription is required.'},409,origin);";
 let result=source.replace(status,replace(status,statusNew));
 const ai="      let isOwner,aiPlan;\n      try{isOwner=await phOwnerEntitlement(env,user.id);aiPlan=isOwner?null:await phSubscriptionRow(env,user.id)}";
 const aiNew="      let isOwner,aiPlan,business;\n      try{isOwner=await phOwnerEntitlement(env,user.id);aiPlan=isOwner?null:await phSubscriptionRow(env,user.id);business=isOwner||(aiPlan?.stripe_price_id===PH_PRICE_ID&&['active','trialing'].includes(aiPlan?.status)&&(!aiPlan.current_period_end||new Date(aiPlan.current_period_end).getTime()>Date.now()))?null:await businessProAccess(env,user.id)}";
 result=result.replace(ai,replace(ai,aiNew));
 const condition="      if(!isOwner && (aiPlan?.stripe_price_id!==PH_PRICE_ID";
 result=result.replace(condition,replace(condition,"      if(!isOwner && !business && (aiPlan?.stripe_price_id!==PH_PRICE_ID"));
 return helper+'\n'+result;
}
module.exports={build};
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Supply the inspected baseline and output paths');fs.writeFileSync(output,build(fs.readFileSync(input,'utf8')));console.log('Built gated Business access candidate; existing live Worker has not changed.');}
