/* ROBBIT landing — runtime configuration.
   Non-developer safe: change endpoints, links and tracking IDs here. */
window.ROBBIT_CONFIG = {
  leadEndpoint: '/api/lead',
  telegramUrl:  'https://t.me/robbituz',
  instagramUrl: 'https://www.instagram.com/robbituz/',
  phone: '+998787773777',
  phoneDisplay: '+998 78 777 37 77',
  /* Meta Pixel — bo'sh qoldirilsa hech narsa yuklanmaydi (cookie-free). */
  metaPixelId: '349660218140505'
};

/* Meta Pixel loader (faqat ID berilgan bo'lsa ishlaydi) */
(function(){
  var id = (window.ROBBIT_CONFIG && window.ROBBIT_CONFIG.metaPixelId) || '';
  if (!id) return;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
  (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', id); fbq('track', 'PageView');
})();
