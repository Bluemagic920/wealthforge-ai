
(()=>{'use strict';
const el=id=>document.getElementById(id);
const ids=['phSenderMode','phSenderName','phSenderAddress','phReplyTo'];
function render(){
 const mode=el('phSenderMode').value;
 const name=el('phSenderName').value.trim()||el('sigCompany').value.trim()||'Your Business';
 const addr=el('phSenderAddress').value.trim();
 const reply=el('phReplyTo').value.trim();
 const display=mode==='domain'?(addr||'invoices@yourbusiness.com'):'ProfitHarbor-managed address (not yet assigned)';
 el('phSenderPreview').textContent=name+' <'+display+'> | Reply-To: '+(reply||'Not configured');
 el('phSenderGuidance').textContent=mode==='domain'?'Domain option requires verified domain ownership, approved DNS records, and server authorization before sending.':'Managed option will use a clearly identified ProfitHarbor sending domain; the subscriber business name may be displayed, with an authorized Reply-To address.';
}
ids.concat(['sigCompany']).forEach(id=>el(id).addEventListener('input',render));
el('phSettingsLoad').addEventListener('click',()=>setTimeout(render,0));
render();
})();
