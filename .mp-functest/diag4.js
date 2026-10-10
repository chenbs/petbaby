const { EventEmitter } = require('events');
const origEmit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (type) {
  if (type === 'error' && this.listenerCount && this.listenerCount('error') === 0) {
    const e = arguments[1];
    console.log('!! [intercepted error event] type:', typeof e, '| value:', (e && e.message) || JSON.stringify(e) || String(e));
    if (e && e.stack) console.log('   stack:', String(e.stack).slice(0, 500));
    return false;
  }
  return origEmit.apply(this, arguments);
};
const automator = require('miniprogram-automator');
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async () => {
  const mp = await automator.connect({ wsEndpoint: process.env.MP_WS });
  console.log('connected');
  await mp.reLaunch(process.env.MP_ROUTE || '/pages/pets/pets');
  await sleep(5000);
  const page = await mp.currentPage();
  console.log('path:', page.path);
  const d = await page.data();
  console.log('pets:', JSON.stringify((d.pets||[]).map(p=>p.name)));
  console.log('error:', JSON.stringify(d.error), 'loading:', d.loading);
  process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.message);process.exit(1);});
