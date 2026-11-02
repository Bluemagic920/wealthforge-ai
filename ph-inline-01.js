
(function(){
  'use strict';
  var id='G-D1FQRSWHQ1';
  if(!/^G-[A-Z0-9]{6,15}$/.test(id)||id==='G-XXXXXXXXXX')return;
  var s=document.createElement('script');
  s.async=true;
  s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);
  document.head.appendChild(s);
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){window.dataLayer.push(arguments)};
  window.gtag('js',new Date());
  window.gtag('config',id,{send_page_view:true,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:location.origin+location.pathname,page_title:document.title});
})();
