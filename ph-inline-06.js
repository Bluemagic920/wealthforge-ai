
(()=>{'use strict';
const ids=['sigName','sigTitle','sigCompany','sigPhone','sigWebsite','sigClosing','sigFont','sigSize','sigColor','sigMessage'];
const get=id=>document.getElementById(id);
const preview=get('sigPreview'),logoInput=get('sigLogo');let logoUrl='';
function add(parent,text,tag='div'){if(!text)return;const el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;}
function update(){preview.replaceChildren();const wrap=document.createElement('div');wrap.style.fontFamily=get('sigFont').value;wrap.style.fontSize=get('sigSize').value+'px';wrap.style.color=get('sigColor').value;wrap.style.lineHeight='1.5';
add(wrap,get('sigClosing').value);add(wrap,get('sigMessage').value);const name=add(wrap,get('sigName').value,'strong');if(name)name.style.display='block';add(wrap,get('sigTitle').value);add(wrap,get('sigCompany').value);add(wrap,get('sigPhone').value);
const website=get('sigWebsite').value.trim();if(website)add(wrap,website);if(logoUrl){const img=document.createElement('img');img.src=logoUrl;img.alt='Company logo preview';img.style.cssText='display:block;max-width:180px;max-height:90px;object-fit:contain;margin-top:12px';wrap.appendChild(img);}preview.appendChild(wrap);}
ids.forEach(id=>get(id).addEventListener('input',update));
logoInput.addEventListener('change',()=>{const file=logoInput.files?.[0];if(logoUrl){URL.revokeObjectURL(logoUrl);logoUrl='';}if(!file){update();return;}if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880){logoInput.value='';get('sigStatus').textContent='Choose a PNG, JPG, or WebP image up to 5 MB.';update();return;}logoUrl=URL.createObjectURL(file);get('sigStatus').textContent='Logo preview loaded. This image has not been uploaded or saved.';update();});
get('sigClearLogo').addEventListener('click',()=>{if(logoUrl)URL.revokeObjectURL(logoUrl);logoUrl='';logoInput.value='';update();});update();
})();
