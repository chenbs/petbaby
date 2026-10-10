const automator = require("miniprogram-automator");
const WS = process.env.MP_WS || "ws://127.0.0.1:9471";
const route = process.env.MP_ROUTE;
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  const ex = [];
  mp.on("exception", e => { ex.push(e.message || JSON.stringify(e)); });
  mp.on("console", m => { const t=(m.args||[]).join(" "); if(m.type==="error") ex.push("console:"+t.slice(0,300)); });
  await mp.reLaunch(route);
  await sleep(3500);
  const page = await mp.currentPage();
  const d = await page.data();
  console.log("path:", page.path);
  console.log("scalars:", JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k,v])=>k!=="__webviewId__"&&(typeof v!=="object"||v===null)))));
  console.log("kinds:", JSON.stringify((d.kinds||[]).map(k=>({kind:k.kind,label:k.label}))));
  console.log("groups:", JSON.stringify((d.groups||[]).map(g=>({id:g.id,label:g.label}))));
  console.log("pets:", JSON.stringify((d.pets||[]).map(p=>p.name)));
  console.log("previews:", JSON.stringify((d.previews||[]).map(p=>({id:p.id,name:p.name,active:p.active}))));
  console.log("exceptions:", JSON.stringify(ex.slice(0,6)));
})().catch(e=>{console.error("FATAL",e&&e.stack);process.exit(1);});
