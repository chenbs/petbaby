const automator = require('miniprogram-automator');
process.on('uncaughtException', e => console.log('UNCAUGHT:', e && e.message));
(async () => {
  const mp = await automator.connect({ wsEndpoint: process.env.MP_WS });
  console.log('connected');
  for (let i=0;i<10;i++){
    try { const p = await mp.currentPage(); console.log('ok', i, p && p.path); break; }
    catch(e){ console.log('retry', i, e.message); }
    await new Promise(r=>setTimeout(r,3000));
  }
})();
