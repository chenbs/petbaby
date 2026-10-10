const automator = require("miniprogram-automator");
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e && e.message); });
(async () => {
  const mp = await automator.connect({ wsEndpoint: process.env.MP_WS });
  console.log('connected');
  for (let i=0;i<12;i++) {
    try {
      const p = await mp.currentPage();
      console.log('try', i, 'path=', p && p.path);
      if (p && p.path) break;
    } catch (e) { console.log('try', i, 'err:', e.message); }
    await sleep(4000);
  }
})().catch(e=>console.error('FATAL', e && e.message));
