const fs=require('fs'),vm=require('vm');
class Element{
 constructor(tag='div',document=null){this.tag=tag;this.document=document;this.children=[];this.events={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.dataset={};this.classList={toggle(){}};this.attrs={};}
 set id(v){this._id=v;this.document?.nodes.set(v,this);}get id(){return this._id;}
 set innerHTML(v){this._html=v;for(const m of v.matchAll(/<(\w+)[^>]*\bid="([^"]+)"([^>]*)>/g)){const node=new Element(m[1],this.document);node.id=m[2];node.hidden=/\bhidden\b/.test(m[3]);node.value=m[3].match(/\bvalue="([^"]*)"/)?.[1]||'';if(m[1]==='select'){const option=new Element('option');option.value='';option.textContent='Choose campaign';node.append(option);}this.children.push(node);}}
 get innerHTML(){return this._html;}
 append(...children){this.children.push(...children);}add(node){this.append(node);}replaceChildren(...children){this.children=[...children];if(this.tag==='select')this.value=children[0]?.value||'';}
 get options(){return this.children;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}insertAdjacentElement(_where,el){this.children.push(el);}focus(){}select(){}
 addEventListener(name,fn){(this.events[name]||=[]).push(fn);}async emit(name){for(const fn of this.events[name]||[])await fn({target:this});}
}
function dom(){
 const document={nodes:new Map(),events:{},pending:[],hidden:false,getElementById(id){return this.nodes.get(id)||null;},createElement(tag){return new Element(tag,this);},createTextNode(text){return {textContent:text};},querySelectorAll(){return [];},querySelector(){return null;},addEventListener(name,fn){(this.events[name]||=[]).push(fn);},dispatchEvent(event){for(const fn of this.events[event.type]||[]){const p=fn(event);if(p?.then)this.pending.push(p);}return true;}};
 for(const id of ['leads','phLeadBack','phLeadNext','phLeadStatus','phLeadCampaignList','phLeadListStatus','phLeadRefresh','phLeadSource','phLeadCampaign']){const n=document.createElement('div');n.id=id;}
 const Option=function(label,value){const n=new Element('option',document);n.textContent=label;n.value=value;return n;};
 return {document,Option};
}
function ui(backend){
 const {document,Option}=dom();let session={user:{id:'11111111-1111-4111-8111-111111111111'},access_token:'fixture'},listener;const requests=[];
 const timers=[];const window={addEventListener(){},confirm:()=>true,prompt:()=>null,wealthforgeAuthClient:{auth:{getSession:async()=>({data:{session}}),onAuthStateChange(fn){listener=fn;return {};}}}};
 const context=vm.createContext({window,document,Option,URL,AbortSignal,CustomEvent:class{constructor(type,opts={}){this.type=type;this.detail=opts.detail;}},setTimeout(fn){timers.push(fn);},setInterval(){},navigator:{clipboard:{writeText:async()=>{}}},fetch:async(url,init={})=>{requests.push({url,init});return backend(url,init);}});
 for(const p of ['ph-leads-client.js','lead-wizard.js','ph-stage12-tracking-links.js','ph-stage13-hosted-forms.js'])vm.runInContext(fs.readFileSync(p,'utf8'),context,{filename:p});
 return {document,requests,window,async runTimers(){for(const fn of timers.splice(0))await fn();},node:id=>document.getElementById(id),switchAccount(id){session=id?{user:{id},access_token:'replacement'}:null;listener('SIGNED_OUT',session);},async flush(){while(document.pending.length)await Promise.all(document.pending.splice(0));}};
}
module.exports={ui};
