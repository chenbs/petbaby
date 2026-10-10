const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  const H = { authorization: 'Bearer '+token, 'x-petbaby-client':'miniprogram' };
  await mp.reLaunch('/pages/fun-tests/fun-tests');
  await L.sleep(4000);
  let page = await mp.currentPage();
  const cards = await page.$$('.fun-test');
  await cards[0].tap();
  await L.sleep(2500);
  const pets = await page.$$('.fun-pet');
  if (pets.length) { await pets[pets.length-1].tap(); await L.sleep(600); }
  const starts = await page.$$('.fun-primary');
  await starts[0].tap();
  await L.sleep(3000);
  for (let i=0;i<12;i++){
    page = await mp.currentPage();
    let d = await page.data();
    if (d.stage === 'result' || d.result) break;
    const choices = await page.$$('.fun-choice');
    if (!choices.length) { await L.sleep(2000); continue; }
    await choices[0].tap();
    await L.sleep(900);
  }
  // 等结果
  for (let i=0;i<10;i++){
    page = await mp.currentPage();
    let d = await page.data();
    if (d.result) { console.log('结果已出:', JSON.stringify(d.result).slice(0,400)); break; }
    if (d.error) { console.log('错误:', d.error); break; }
    await L.sleep(2500);
  }
  page = await mp.currentPage();
  const d = await page.data();
  console.log('最终 stage:', d.stage, '有结果:', Boolean(d.result), 'error:', d.error);
  const res = await L.wxRequest(mp, { url: L.BASE + '/api/fun-test-results', header: H });
  const list = (res.body&&res.body.data)||[];
  console.log('服务端结果数:', list.length, list[0] ? JSON.stringify({testId:list[0].testId, outcome:(list[0].outcome||{}).name}) : '');
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
