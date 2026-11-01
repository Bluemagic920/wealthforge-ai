(()=>{'use strict';
const API='https://wealthforge-ai-api.bluemagic920.workers.dev/api/chat';
const $=id=>document.getElementById(id);
const prompt=$('aiPrompt'),send=$('aiSend'),status=$('aiStatus'),chat=$('aiChat'),history=$('aiHistory'),usage=$('aiUsage');
let sending=false, accountId=null, threads=[],activeId=null;
const welcome='Welcome! Choose a suggestion or type your question below. Sign in under Cloud Accounts, choose a suggestion, and send a test question. Do not include private customer or financial details.';
const id=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
const storeKey=uid=>'wealthforge-v171-local-chat:'+uid;
let cloudReady=false;
let saving=Promise.resolve();
const chatTable='wealthforge_chats';
function setStatus(t){status.textContent=t;}
function safeText(v){return String(v??'').slice(0,16000);}
function addMessage(who,message){
 const wrap=document.createElement('div');wrap.style.cssText='padding:12px 14px;margin:10px 0;border:1px solid #355987;border-radius:10px;background:'+(who==='You'?'#183966':'#10284d');
 const heading=document.createElement('strong');heading.textContent=who;
 const content=document.createElement('div');content.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;margin-top:6px';
 // Format only simple Markdown lines, using textContent rather than inserting untrusted HTML.
 safeText(message).split('\n').forEach((line,i)=>{
  if(i)content.append(document.createElement('br'));
  const match=line.match(/^\s*(#{1,3})\s+(.+)$/);
  if(match){const h=document.createElement('strong');h.textContent=match[2];content.append(h);return;}
  const list=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
  if(list){content.append(document.createTextNode('• '+list[1]));return;}
  // Render **bold** spans safely.
  line.split(/(\*\*[^*]+\*\*)/g).forEach(part=>{if(/^\*\*[^*]+\*\*$/.test(part)){const b=document.createElement('strong');b.textContent=part.slice(2,-2);content.append(b);}else content.append(document.createTextNode(part));});
 });
 wrap.append(heading,content);chat.append(wrap);chat.scrollTop=chat.scrollHeight;
}
function current(){return threads.find(t=>t.id===activeId);}
function save(){if(!accountId)return;try{localStorage.setItem(storeKey(accountId),JSON.stringify({threads:threads.slice(0,12),activeId}));}catch{setStatus('Local storage full; export your chat.');}persistCloud();}
function persistCloud(){if(!cloudReady||!accountId)return;const uid=accountId;
 const snapshot=threads.slice(0,12).map(t=>({id:t.id,title:t.title,messages:t.messages}));
 saving=saving.catch(()=>{}).then(async()=>{if(!cloudReady||uid!==accountId)return;
 const sb=window.wealthforgeAuthClient;
 const {error}=await sb.from(chatTable).upsert({user_id:uid,slot:'main',payload:{threads:snapshot,activeId}}, {onConflict:'user_id,slot'});
 if(error){cloudReady=false;setStatus('Chat cloud save unavailable; chats remain saved in this browser. Check Supabase setup.');}
 });
}
function renderHistory(){history.replaceChildren();threads.forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.title||'New conversation';history.append(o);});history.value=activeId||'';}
function render(){chat.replaceChildren();const t=current();if(!t||!t.messages.length){addMessage('WealthForge Assistant',welcome);}else t.messages.forEach(m=>addMessage(m.who,m.text));renderHistory();}
function newChat(){const t={id:id(),title:'New conversation',messages:[]};threads.unshift(t);threads=threads.slice(0,12);activeId=t.id;save();render();setStatus('New conversation ready.');}
function load(uid){if(accountId===uid)return;accountId=uid;cloudReady=false;threads=[];activeId=null;
 try{const saved=JSON.parse(localStorage.getItem(storeKey(uid))||'null');if(saved&&Array.isArray(saved.threads)){threads=saved.threads.filter(t=>t&&typeof t.id==='string'&&Array.isArray(t.messages)).slice(0,12).map(t=>({id:t.id,title:safeText(t.title).slice(0,65),messages:t.messages.filter(m=>m&&['You','WealthForge Assistant'].includes(m.who)&&typeof m.text==='string').slice(-30)}));activeId=saved.activeId;}}catch{}
 if(!threads.some(t=>t.id===activeId)){const t={id:id(),title:'New conversation',messages:[]};threads.unshift(t);activeId=t.id;}render();loadCloud(uid);}
async function loadCloud(uid){try{const sb=window.wealthforgeAuthClient;const {data,error}=await sb.from(chatTable).select('payload').eq('user_id',uid).eq('slot','main').maybeSingle();if(uid!==accountId)return;if(error)throw error;cloudReady=true;if(data?.payload&&Array.isArray(data.payload.threads)){const remote=data.payload;threads=remote.threads.filter(t=>t&&typeof t.id==='string'&&Array.isArray(t.messages)).slice(0,12);activeId=threads.some(t=>t.id===remote.activeId)?remote.activeId:threads[0]?.id;if(!threads.length)newChat();else{render();localStorage.setItem(storeKey(uid),JSON.stringify({threads,activeId}));}setStatus('Chat history loaded securely from Supabase.');}else{persistCloud();setStatus('Chat cloud storage connected.');}}catch{cloudReady=false;setStatus('Cloud chat storage not configured; chats saved only in this browser.');}}
function forgetView(){accountId=null;cloudReady=false;threads=[];activeId=null;chat.replaceChildren();addMessage('WealthForge Assistant',welcome);history.replaceChildren();usage.textContent='Daily requests: sign in to begin';}
async function session(){const sb=window.wealthforgeAuthClient;if(!sb)throw new Error('Cloud authentication unavailable.');const result=await sb.auth.getSession();if(result.error)throw result.error;return result.data?.session;}
async function syncAccount(){try{const s=await session();if(s?.user?.id)load(s.user.id);else if(accountId)forgetView();}catch{}}
$('aiNewChat').onclick=()=>{if(sending)return;newChat();};
history.onchange=()=>{if(sending)return;activeId=history.value;save();render();};
$('aiExportChat').onclick=()=>{const t=current();if(!t||!t.messages.length)return setStatus('No messages to export yet.');const data=t.messages.map(m=>m.who+'\n'+m.text).join('\n\n---\n\n');const blob=new Blob([data],{type:'text/plain;charset=utf-8'});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='wealthforge-chat-'+new Date().toISOString().slice(0,10)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);setStatus('Chat exported to a text file.');};
document.querySelectorAll('[data-ai-prompt]').forEach(b=>b.addEventListener('click',()=>{prompt.value=b.dataset.aiPrompt;prompt.focus();setStatus('Suggested question selected. Click Send.');}));
$('aiClear').onclick=()=>{prompt.value='';setStatus('Question cleared.');};
$('aiCopy').onclick=async()=>{if(!prompt.value.trim())return setStatus('Enter or select a question first.');try{await navigator.clipboard.writeText(prompt.value);setStatus('Question copied.');}catch{setStatus('Clipboard unavailable; select and copy manually.');}};
send.onclick=async()=>{
 if(sending)return;const question=prompt.value.trim();if(!question)return setStatus('Enter a question first.');if(question.length>3000)return setStatus('Question must be 3000 characters or less.');
 let s;try{s=await session();}catch{return setStatus('Could not check your sign-in. Please try again.');}
 if(!s?.access_token||!s?.user?.id)return setStatus('Sign in under Cloud Accounts first.');load(s.user.id);
 sending=true;send.disabled=true;send.textContent='Sending…';setStatus('Sending securely through the Cloudflare Worker…');
 try{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);let response;
 try{response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify({message:question,history:(current()?.messages||[]).slice(-12).map(m=>({role:m.who==='You'?'user':'model',text:m.text.slice(0,3000)}))}),signal:controller.signal});}finally{clearTimeout(timeout);}
 const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||('Request failed (HTTP '+response.status+')'));
 if(typeof payload.answer!=='string'||!payload.answer.trim())throw new Error('AI returned an empty answer.');
 const t=current();if(t.messages.length===0)t.title=question.slice(0,65);t.messages.push({who:'You',text:question},{who:'WealthForge Assistant',text:payload.answer});t.messages=t.messages.slice(-30);save();render();prompt.value='';
 if(Number.isFinite(payload.remaining))usage.textContent='Approx. '+payload.remaining+' of 10 daily requests remaining (UTC)';
 setStatus(cloudReady?'AI reply received. Chat queued for secure cloud save.':'AI reply received. Chat saved locally; cloud chat setup required.');
 }catch(err){setStatus(err.name==='AbortError'?'AI request timed out. Please try again.':'AI error: '+err.message+' Your question was kept for retry.');}
 finally{sending=false;send.disabled=false;send.textContent='Send';}
};
prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send.click();}});
window.addEventListener('focus',syncAccount);document.querySelector('[data-tab="assistant"]')?.addEventListener('click',syncAccount);syncAccount();
})();
