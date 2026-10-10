const automator = require('miniprogram-automator');
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async () => {
  const mp = await automator.connect({ wsEndpoint: process.env.MP_WS });
  const seen = [];
  mp.on('error', e => { const m=(e&&e.message)||JSON.stringify(e); seen.push('ERROR: '+m); console.log('!! error event:', m); });
  mp.on('exception', e => { const m=(e&&e.message)||JSON.stringify(e); seen.push('EXC: '+m); console.log('!! exception event:', m); });
  mp.on('console', m => { const t=(m.args||[]).join(' '); if(m.type==='error') console.log('!! console.error:', t.slice(0,300)); });
  console.log('connected');
  await mp.reLaunch(process.env.MP_ROUTE || '/pages/pets/pets');
  await sleep(5000);
  try {
    const page = await mp.currentPage();
    console.log('path:', page.path);
  } catch(e){ console.log('currentPage failed:', e && e.message); }
  console.log('collected:', JSON.stringify(seen));
  process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
