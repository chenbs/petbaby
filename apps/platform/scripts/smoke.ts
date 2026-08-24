/**
 * 部署后主链路自检：注册 → 建档 → 上传 → 生成 → 解锁 → 分享 → 清理。
 * 用 `x-petbaby-client: miniprogram` + Bearer Token 调用，因此可以在 Compose 网络内直连
 * `http://web:3000`，不受同源校验限制。
 *
 * 用法：pnpm exec tsx scripts/smoke.ts [baseUrl]
 */

const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || "http://web:3000").replace(/\/$/, "");
const inviteCode = process.env.PASSWORD_AUTH_INVITE_CODE || undefined;
const suffix = Math.random().toString(36).slice(2, 8);
const account = `smoke${suffix}`;
const password = `smoke-${suffix}-2026`;

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=", "base64");

let sessionToken = "";
const steps: string[] = [];

function headers(extra: Record<string, string> = {}) {
  return { "x-petbaby-client": "miniprogram", ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}), ...extra };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${payload?.error?.code || ""} ${payload?.error?.message || text}`.trim());
  return (payload.data ?? payload) as T;
}

function ok(label: string) {
  steps.push(label);
  console.log(`  ok  ${label}`);
}

function skip(label: string, reason: string) {
  steps.push(`${label}（跳过：${reason}）`);
  console.log(`  --  ${label} 跳过：${reason}`);
}

async function main() {
  console.log(`冒烟测试目标：${baseUrl}`);

  const health = await call<{ status: string; database: boolean; stale?: number }>("GET", "/api/health");
  if (health.status !== "ok" || !health.database) throw new Error(`健康检查未通过：${JSON.stringify(health)}`);
  ok("健康检查 /api/health status=ok database=true");

  const authInfo = await call<{ passwordAuth: { enabled: boolean; inviteRequired: boolean } }>("GET", "/api/auth/session");
  if (!authInfo.passwordAuth.enabled) throw new Error("账号密码登录未启用，请设置 PASSWORD_AUTH_ENABLED=true");
  if (authInfo.passwordAuth.inviteRequired && !inviteCode) throw new Error("环境要求邀请码，但容器内没有读到 PASSWORD_AUTH_INVITE_CODE");
  ok("账号密码登录已启用");

  const registered = await call<{ userId: string; sessionToken: string }>("POST", "/api/auth/password/register", { accountName: account, password, displayName: "冒烟测试", inviteCode });
  sessionToken = registered.sessionToken;
  ok(`注册并登录测试账号 ${account}`);

  const plugins = await call<Array<{ id: string; status: string }>>("GET", "/api/plugins");
  const plugin = plugins.find((item) => item.id === "pet-id-card" && item.status === "live") || plugins.find((item) => item.status === "live");
  if (!plugin) throw new Error("没有任何 status=live 的玩法，检查 plugin_configs 播种是否成功");
  ok(`玩法清单可用（使用 ${plugin.id}）`);

  const pet = await call<{ id: string }>("POST", "/api/pets", { name: "冒烟年糕", species: "cat", gender: "unknown", dateType: "birthday", lifeStage: "active" });
  ok("创建宠物档案");

  const form = new FormData();
  form.set("petId", pet.id);
  form.set("filename", "smoke.png");
  form.set("file", new Blob([new Uint8Array(tinyPng)], { type: "image/png" }), "smoke.png");
  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, { method: "POST", headers: headers(), body: form });
  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok) throw new Error(`POST /api/uploads → ${uploadResponse.status} ${uploadText}`);
  const photo = JSON.parse(uploadText).data as { id: string; storageKey?: string };
  ok("上传照片并写入对象存储");

  const task = await call<{ id: string }>("POST", "/api/generations", {
    pluginId: plugin.id,
    petId: pet.id,
    photoIds: [photo.id],
    idempotencyKey: `smoke-${suffix}-${Date.now()}`,
  });
  ok("提交生成任务");

  type Task = { status: string; workId?: string; errorCode?: string };
  let finished: Task | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    finished = await call<Task>("GET", `/api/generations/${task.id}`);
    if (finished.status === "succeeded" || finished.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (finished?.status !== "succeeded") throw new Error(`生成任务未成功（status=${finished?.status}，errorCode=${finished?.errorCode || "-"}），检查 worker 容器日志`);
  ok("Worker 完成生成任务");

  const workId = finished.workId;
  if (!workId) throw new Error("生成成功但没有返回 workId");
  const work = await call<{ id: string; locked: boolean; previewKey?: string; outputKey?: string }>("GET", `/api/works/${workId}`);
  ok("读取作品详情");

  const mediaKey = work.previewKey || work.outputKey;
  if (!mediaKey) throw new Error("作品没有预览或成品文件，对象存储写入可能失败");
  const media = await fetch(`${baseUrl}/api/media/${mediaKey}`, { headers: headers() });
  if (!media.ok) throw new Error(`读取 /api/media/${mediaKey} 失败 → ${media.status}`);
  ok("通过 /api/media 读回对象存储文件");

  const paymentSimulated = process.env.PAYMENT_PROVIDER !== "wechat";
  if (paymentSimulated) {
    const order = await call<{ id: string }>("POST", "/api/orders", { workId });
    await call("POST", `/api/orders/${order.id}/pay`, {});
    const unlocked = await call<{ locked: boolean }>("GET", `/api/works/${workId}`);
    if (unlocked.locked) throw new Error("模拟支付后作品仍处于锁定状态");
    ok("下单并用模拟支付解锁（测试环境专用）");
  } else {
    skip("下单与解锁", "PAYMENT_PROVIDER=wechat，需要真实微信支付联调");
  }

  const shared = await call<{ token: string; path: string }>("POST", `/api/works/${workId}/share`, {});
  if (!shared.token) throw new Error("生成分享链接失败");
  const shareResponse = await fetch(`${baseUrl}${shared.path}`, { redirect: "manual" });
  if (!shareResponse.ok) throw new Error(`匿名访问分享页 ${shared.path} 失败 → ${shareResponse.status}`);
  ok(`生成分享链接并匿名访问成功（${shared.path}）`);

  await call("POST", "/api/account/delete", {});
  ok("清理测试账号（软删除）");

  console.log(`\n冒烟测试全部通过（${steps.length} 步）。`);
}

main().catch((error) => {
  console.error(`\n冒烟测试失败：${error instanceof Error ? error.message : String(error)}`);
  console.error(`已完成步骤：${steps.length ? steps.join(" / ") : "无"}`);
  process.exitCode = 1;
});
