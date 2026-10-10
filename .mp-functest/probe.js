const automator = require("miniprogram-automator");
const ws = process.env.MP_WS || "ws://127.0.0.1:9420";
(async () => {
  const mp = await automator.connect({ wsEndpoint: ws });
  const page = await mp.currentPage();
  console.log("ws:", ws);
  console.log("current path:", page && page.path);
  await mp.close();
})().catch((e) => {
  console.error("ERR", ws, e && e.message);
  process.exit(1);
});
