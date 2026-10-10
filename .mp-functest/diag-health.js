const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  const H = { authorization: 'Bearer '+token, 'x-petbaby-client':'miniprogram' };
  const pets = await L.wxRequest(mp, { url: L.BASE + '/api/pets', header: H });
  const pet = pets.body.data[1];
  console.log('pet:', pet.name, pet.id);

  // 直接用端上同款接口路径发一次分诊
  const before = await L.wxRequest(mp, { url: L.BASE + '/api/health-sessions?petId=' + pet.id, header: H });
  console.log('分诊前会话数:', ((before.body&&before.body.data)||[]).length, 'status', before.status);

  const submit = await L.wxRequest(mp, {
    url: L.BASE + '/api/health-sessions',
    method: 'POST',
    data: { petId: pet.id, description: '从昨天开始不太吃东西，今天吐了两次，精神比平时差' },
    header: Object.assign({'content-type':'application/json'}, H),
  });
  console.log('提交 status:', submit.status);
  console.log('提交 body:', JSON.stringify(submit.body).slice(0, 700));

  const after = await L.wxRequest(mp, { url: L.BASE + '/api/health-sessions?petId=' + pet.id, header: H });
  const list = (after.body&&after.body.data)||[];
  console.log('分诊后会话数:', list.length);
  if (list[0]) {
    const s = list[0];
    console.log('首条字段:', Object.keys(s).join(','));
    console.log('triageSource:', s.triageSource, '| level:', s.level || s.urgencyLevel, '| urgentAreas:', JSON.stringify(s.urgentAreas));
    console.log('summary:', String(s.summary||'').slice(0,200));
    console.log('advisory:', JSON.stringify(s.advisory).slice(0,400));
  }
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error('FATAL',e&&e.stack);process.exit(1);});
