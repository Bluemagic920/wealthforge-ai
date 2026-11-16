(()=>{'use strict';
const origin='https://profitharbor-leads-api.bluemagic920.workers.dev';
let epoch=0,owner=null,watched=null;
function invalidate(){epoch++;document.dispatchEvent(new CustomEvent('ph:leads-account-changed'));}
async function capture(){
 const client=window.wealthforgeAuthClient;if(!client?.auth?.getSession)throw Error('Sign in under Account first.');
 if(watched!==client){watched=client;client.auth.onAuthStateChange?.((_event,session)=>{const id=session?.user?.id||null;if(id!==owner){owner=id;invalidate();}});}
 const {data,error}=await client.auth.getSession(),session=data?.session;
 if(error||!session?.access_token||!session.user?.id)throw Error('Sign in under Account first.');
 if(owner!==session.user.id){owner=session.user.id;invalidate();}
 return {user:owner,epoch,token:session.access_token};
}
async function current(context){const next=await capture();if(context.user!==next.user||context.epoch!==next.epoch)throw Error('Account changed. Refresh campaigns before continuing.');return next;}
async function request(path,{method='GET',body,context}={}){
 if(!path.startsWith('/api/leads/')||path.includes('://'))throw Error('Invalid campaign request');
 const actor=context?await current(context):await capture();
 const response=await fetch(origin+path,{method,redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+actor.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();await current(actor);
 if(!response.ok)throw Error(result.error||'Campaign service unavailable. Refresh before another attempt.');
 return result;
}
window.phLeadApi=Object.freeze({capture,current,request});
})();
