/* ProfitHarbor AI v0.5.18 — mobile navigation only; does not modify account or billing. */
(()=>{'use strict';
 const toggle=document.getElementById('phMobileNavToggle');
 const nav=document.getElementById('phMainTabs');
 if(!toggle||!nav)return;
 const close=()=>{nav.classList.remove('ph-mobile-open');toggle.setAttribute('aria-expanded','false')};
 toggle.addEventListener('click',()=>{const opened=nav.classList.toggle('ph-mobile-open');toggle.setAttribute('aria-expanded',String(opened));});
 nav.addEventListener('click',e=>{if(e.target.closest('button[data-tab]')&&window.matchMedia('(max-width:650px)').matches)close()});
 window.addEventListener('resize',()=>{if(window.innerWidth>650)close()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
})();
