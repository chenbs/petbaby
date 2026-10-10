const L = require('./lib');
(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, 'functest01', 'petbaby2026test');
  const res = await L.wxRequest(mp, { url: L.BASE + '/api/pets', header: { 'x-petbaby-client':'miniprogram', authorization: 'Bearer '+token } });
  console.log(JSON.stringify((res.body.data||[]).map(p=>({id:p.id,name:p.name,species:p.species}))));
  mp.disconnect(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
