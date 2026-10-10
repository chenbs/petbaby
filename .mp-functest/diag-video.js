const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  const H = { authorization: 'Bearer '+token, 'x-petbaby-client':'miniprogram' };
  const pets = await L.wxRequest(mp, { url: L.BASE + '/api/pets', header: H });
  const pet = pets.body.data[1];
  const plugins = await L.wxRequest(mp, { url: L.BASE + '/api/plugins', header: H });
  console.log('plugins:', (plugins.body.data||[]).map(p=>p.id+':'+p.name).join(' | '));
  const videos = await L.wxRequest(mp, { url: L.BASE + '/api/video-projects', header: H });
  console.log('video-projects status:', videos.status, JSON.stringify(videos.body).slice(0,200));
  await mp.reLaunch('/pages/video-create/video-create?petId='+pet.id);
  await L.sleep(5000);
  const d = await (await mp.currentPage()).data();
  console.log('video-create 关键字段:', JSON.stringify({
    petId: d.petId, pets: (d.pets||[]).length, photos: (d.photos||[]).length,
    templates: (d.templates||[]).length, plugins: (d.plugins||[]).length,
    themes: d.themes, duration: d.durationOptions && d.durationOptions.length,
    error: d.error, costText: d.costText, scenes: (d.scenes||[]).length
  }));
  console.log('全部字段:', Object.keys(d).join(','));
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
