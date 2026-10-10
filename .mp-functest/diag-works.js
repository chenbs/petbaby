const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  const api = await L.wxRequest(mp, { url: L.BASE + '/api/works', header: { 'x-petbaby-client':'miniprogram', authorization: 'Bearer '+token } });
  console.log('接口作品数:', ((api.body&&api.body.data)||[]).length);
  await mp.switchTab('/pages/works/works');
  await L.sleep(6000);
  const page = await mp.currentPage();
  const d = await page.data();
  console.log('页面 path:', page.path);
  console.log('loading:', d.loading, 'error:', JSON.stringify(d.error), 'tab:', d.tab, 'petId:', d.petId);
  console.log('counts:', JSON.stringify(d.counts));
  console.log('groups 月数:', (d.groups||[]).length);
  console.log('groups 卡片总数:', (d.groups||[]).reduce((n,g)=>n+((g.left||[]).length)+((g.right||[]).length),0));
  console.log('progress 数:', (d.progress||[]).length);
  console.log('filtered:', d.filtered);
  // 可见卡片文案
  const all = await page.$$('view');
  const cards = [];
  for (const v of all) {
    let cls=''; try { cls = await v.attribute('class'); } catch(e){}
    if (cls && /work-card|feed-item|item-card|gallery/.test(cls)) {
      let t=''; try { t = await v.text(); } catch(e){}
      cards.push(cls + ' :: ' + String(t).replace(/\s+/g,' ').slice(0,50));
    }
  }
  console.log('DOM 里疑似卡片:', JSON.stringify(cards.slice(0,10)));
  const texts = [];
  for (const v of all.slice(0,120)) { let t=''; try{ t=await v.text(); }catch(e){} const s=String(t).replace(/\s+/g,' ').trim(); if(s&&s.length<80) texts.push(s); }
  console.log('可见文案:', JSON.stringify([...new Set(texts)].slice(-15)));
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
