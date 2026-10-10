const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  await L.loginAs(mp, 'functest01', 'petbaby2026test');
  await mp.reLaunch('/pages/fun-tests/fun-tests');
  await L.sleep(4500);
  let page = await mp.currentPage();

  // 真实点第一张测试卡
  const cards = await page.$$('.fun-test');
  console.log('测试卡数:', cards.length);
  await cards[0].tap();
  await L.sleep(3000);
  page = await mp.currentPage();
  let d = await page.data();
  console.log('阶段:', d.stage, '选中测试:', d.test && d.test.title, '宠物:', d.petName);

  // 选宠物（如果有选择器）
  const petItems = await page.$$('.fun-pet');
  console.log('宠物选项:', petItems.length);
  if (petItems.length) { await petItems[petItems.length-1].tap(); await L.sleep(800); }

  // 点开始测试
  const starts = await page.$$('.fun-primary');
  console.log('.fun-primary 数:', starts.length);
  if (starts.length) { await starts[0].tap(); await L.sleep(3500); }
  page = await mp.currentPage();
  d = await page.data();
  console.log('开始后阶段:', d.stage, '题目:', JSON.stringify(d.question).slice(0,200));

  // 答题
  for (let i=0;i<13;i++){
    page = await mp.currentPage();
    d = await page.data();
    if (d.stage === 'result' || d.result) break;
    const choices = await page.$$('.fun-choice');
    if (!choices.length) { console.log('  第'+i+'题无选项, stage='+d.stage); break; }
    await choices[i % choices.length].tap();
    await L.sleep(1200);
  }
  page = await mp.currentPage();
  d = await page.data();
  console.log('最终阶段:', d.stage, '有结果:', Boolean(d.result));
  console.log('结果:', JSON.stringify(d.result).slice(0,500));
  console.log('error:', d.error);
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
