const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  const H = { authorization: 'Bearer '+token, 'x-petbaby-client':'miniprogram' };

  // 趣测：真实点击开始
  await mp.reLaunch('/pages/fun-tests/fun-tests');
  await L.sleep(4500);
  let page = await mp.currentPage();
  let d = await page.data();
  console.log('列表 tests:', (d.tests||[]).map(t=>({id:t.id,title:t.title,questions:(t.questions||t.questionCount)})));
  const all = await page.$$('view');
  for (const v of all) {
    let t=''; try{t=await v.text();}catch(e){}
    const s=String(t).replace(/\s+/g,' ').trim();
    if (s==='开始测试 →' || s==='开始测试') { await v.tap(); break; }
  }
  await L.sleep(3500);
  page = await mp.currentPage();
  d = await page.data();
  console.log('进入后 stage:', d.stage, 'test:', d.test && d.test.title, 'questionIndex:', d.questionIndex, 'progress:', d.progress);
  console.log('question:', JSON.stringify(d.question).slice(0,300));

  // 真实点选项答完
  for (let i=0;i<14;i++){
    page = await mp.currentPage();
    d = await page.data();
    if (d.result || d.stage === 'result') break;
    const opts = (d.question && d.question.options) || [];
    if (!opts.length) { console.log('第'+i+'题无选项'); break; }
    const vs = await page.$$('view');
    let tapped=false;
    for (const v of vs) {
      let cls=''; try{cls=await v.attribute('class');}catch(e){}
      let idx=''; try{idx=await v.attribute('data-index');}catch(e){}
      if (/option/.test(cls||'') && (idx==='0'||idx===0)) { await v.tap(); tapped=true; break; }
    }
    if(!tapped){
      for (const v of vs) {
        let cls=''; try{cls=await v.attribute('class');}catch(e){}
        let t=''; try{t=await v.text();}catch(e){}
        if (/option/.test(cls||'') && String(t).trim().indexOf(opts[0].label)>=0) { await v.tap(); tapped=true; break; }
      }
    }
    await L.sleep(1000);
    if(!tapped) console.log('  第'+i+'题未点到选项');
  }
  page = await mp.currentPage();
  d = await page.data();
  console.log('结果 stage:', d.stage, '有result:', Boolean(d.result), '标题:', d.result && (d.result.title||d.result.testTitle));
  console.log('result 摘要:', JSON.stringify(d.result).slice(0,400));

  // work 页：合法但不存在的 uuid
  await mp.reLaunch('/pages/index/index');
  await L.sleep(800);
  await mp.navigateTo('/pages/work/work?id=00000000-0000-4000-8000-0000000000ff');
  await L.sleep(3000);
  page = await mp.currentPage();
  d = await page.data();
  console.log('\nwork 不存在uuid -> error:', JSON.stringify(d.error), 'work:', Boolean(d.work));
  // work 页：缺 id
  await mp.navigateTo('/pages/work/work');
  await L.sleep(2500);
  page = await mp.currentPage();
  d = await page.data();
  console.log('work 缺id -> error:', JSON.stringify(d.error));
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
