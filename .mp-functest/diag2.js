const automator = require('miniprogram-automator');
process.on('uncaughtException', e => { const m=(e&&e.message)||String(e); if(!/timeout waiting|Connection closed/.test(m)) console.log('UNCAUGHT:',m); });
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async () => {
  const mp = await automator.connect({ wsEndpoint: process.env.MP_WS });
  console.log('connected');
  await mp.reLaunch(process.env.MP_ROUTE || '/pages/pets/pets');
  await sleep(4000);
  const page = await mp.currentPage();
  console.log('path:', page.path);
  for (const tag of ['t-button','button','view']) {
    let els = [];
    for (let k=0;k<3;k++){ try { els = await page.$$(tag); break; } catch(e){ await sleep(2500); } }
    console.log('--- <'+tag+'> '+els.length);
    for (let i=0;i<Math.min(els.length,22);i++){
      let t='',cls='';
      try { t = await els[i].text(); } catch(e){ t='<err '+(e&&e.message)+'>'; }
      try { cls = await els[i].attribute('class'); } catch(e){}
      const s=String(t).replace(/\s+/g,' ').slice(0,60);
      if(s) console.log('   ['+i+'] cls='+cls+' :: '+s);
    }
  }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
