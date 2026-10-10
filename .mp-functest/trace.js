process.on('uncaughtException', (e) => { console.log('UNCAUGHT TYPE:', typeof e, e && e.constructor && e.constructor.name); console.log('RAW:', require('util').inspect(e, {depth: 3})); process.exit(3); });
const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9471' });
  console.log('connected');
  await new Promise(r => setTimeout(r, 2000));
  console.log('idle ok');
  const page = await mp.currentPage();
  console.log('page', page.path);
  await new Promise(r => setTimeout(r, 3000));
  console.log('done');
  process.exit(0);
})();
