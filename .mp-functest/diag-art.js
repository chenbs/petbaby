const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  await mp.reLaunch('/pages/art-photo/art-photo');
  await L.sleep(5000);
  const page = await mp.currentPage();
  const d = await page.data();
  console.log('segments:', JSON.stringify(d.segments));
  console.log('artModes:', JSON.stringify(d.artModes));
  console.log('artMode:', d.artMode, 'segment:', d.segment, 'sceneCount:', d.sceneCount);
  console.log('duoCount:', d.duoCount, 'duoPriceText:', d.duoPriceText);
  console.log('packages:', JSON.stringify(d.packages).slice(0,300));
  console.log('packageMode:', d.packageMode, 'selectedCount:', d.selectedCount, 'dockText:', d.dockText);
  console.log('collections 数:', (d.collections||[]).length);
  console.log('collections[0]:', JSON.stringify((d.collections||[])[0]).slice(0,400));
  // 真实点一个场景/集合
  const all = await page.$$('view');
  const clickable=[];
  for (const v of all.slice(0,200)) {
    let cls=''; try{cls=await v.attribute('class');}catch(e){}
    let id=''; try{id=await v.attribute('data-id');}catch(e){}
    if (cls && /scene|card|chips-item|collection|tile/.test(cls)) clickable.push(cls+'#'+id);
  }
  console.log('可点场景类:', JSON.stringify(clickable.slice(0,12)));
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
