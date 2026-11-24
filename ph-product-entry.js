/* Product links open the existing account and membership interface. */
(()=>{'use strict';
  function openAccount(){
    const business=window.location.hash==='#business-membership';
    if(!business&&window.location.hash!=='#account')return;
    document.querySelector('.tabs [data-tab="cloud"]')?.click();
    const target=document.getElementById(business?'phMembershipTitle':'authEmail');
    target?.scrollIntoView({behavior:'smooth',block:'start'});
    if(!business)target?.focus();
  }
  window.addEventListener('hashchange',openAccount);
  openAccount();
})();
