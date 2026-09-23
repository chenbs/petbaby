const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createUploadSession, preparePhoto, clearRecordDrafts } = require("../services/photo-upload-session");

function failure(statusCode, message) { return Object.assign(new Error(message || "injected"), { statusCode }); }
function fixture(overrides) {
  const storage = {};
  const receipts = {};
  const attempts = [];
  const waits = [];
  const dependencies = Object.assign({
    read: (key) => storage[key], write: (key, value) => { storage[key] = JSON.parse(JSON.stringify(value)); },
    exists: async () => ({ size: 100 }), now: () => 1000,
    wait: async (delay) => waits.push(delay),
    request: async (url) => { const id = url.split("=")[1]; if (!receipts[id]) throw failure(404); return receipts[id]; },
    upload: async (url, path, data) => {
      attempts.push(data.uploadRequestId);
      const photo = { id: "photo-" + data.uploadRequestId };
      receipts[data.uploadRequestId] = { status: "saved", photo };
      return photo;
    }
  }, overrides || {});
  const make = (settings) => createUploadSession(Object.assign({ accountId: "account-A", petId: "pet-B", petName: "年糕", dependencies }, settings || {}));
  return { storage, receipts, attempts, waits, dependencies, make };
}
const files = (count) => Array.from({ length: count }, (_, index) => ({ path: "temp-" + index, name: "image-" + index + ".jpg" }));

test("A02：9 张中两张失败，重试仅上传失败项，7 个成功 ID 保留", async () => {
  const f = fixture();
  const normal = f.dependencies.upload;
  const failed = new Set(["temp-2", "temp-6"]);
  f.dependencies.upload = async (url, path, data) => { if (failed.has(path)) throw failure(422); return normal(url, path, data); };
  const session = f.make(); session.add(files(9));
  const first = await session.run();
  assert.equal(first.savedCount, 7); assert.equal(first.pendingCount, 2);
  const saved = first.items.filter((item) => item.state === "saved").map((item) => item.photoId);
  failed.clear();
  const final = await session.run();
  assert.equal(final.savedCount, 9); assert.equal(new Set(f.attempts).size, 9);
  saved.forEach((id) => assert.ok(final.items.some((item) => item.photoId === id)));
});

test("A03：服务端已落库但响应丢失，经回执确认成功，不再次上传", async () => {
  const f = fixture();
  const normal = f.dependencies.upload;
  f.dependencies.upload = async (...args) => { await normal(...args); throw failure(0); };
  const session = f.make(); session.add(files(1));
  assert.equal((await session.run()).savedCount, 1);
  assert.equal(f.attempts.length, 1); assert.deepEqual(f.waits, [600]);
});

test("A03/A09：网络最多自动重试两次，413/415/422 不自动重试，429 遵守等待，401 停止批次", async () => {
  for (const status of [0, 500, 413, 415, 422, 429, 401]) {
    let calls = 0, logins = 0;
    const f = fixture({ upload: async () => { calls++; throw Object.assign(failure(status), { retryAfterSeconds: 120 }); } });
    const session = f.make({ onLoginRequired: () => logins++ }); session.add(files(2));
    await session.run();
    assert.equal(calls, status === 0 || status === 500 ? 6 : status === 401 || status === 429 ? 1 : 2);
    assert.equal(logins, status === 401 ? 1 : 0);
    if (status === 429) {
      assert.equal(session.items[0].retryAt, 121000);
      // 一批被限流后，下一次用户重试也不能把剩余文件提前发出去。
      await session.run(); assert.equal(calls, 1);
    }
  }
});

test("A03：中断后恢复先查回执，成功项保留，失效临时文件只提示该项重选", async () => {
  const f = fixture(); const session = f.make(); session.add(files(2));
  session.items[0].attempted = true; session.items[0].state = "uploading";
  session.items[1].attempted = true; session.items[1].state = "uploading";
  f.receipts[session.items[0].requestId] = { status: "saved", photo: { id: "confirmed" } };
  session.stop();
  const resumed = f.make();
  await resumed.reconcile();
  assert.equal(resumed.snapshot().savedCount, 1);
  f.dependencies.exists = async () => { throw failure(422); };
  const expired = f.make();
  await expired.run();
  assert.equal(expired.items[0].photoId, "confirmed");
  assert.equal(expired.items[1].needsReselect, true);
  assert.equal(f.attempts.length, 0);
  assert.equal(f.make({ accountId: "account-B" }).items.length, 0);
  assert.equal(f.make({ petId: "pet-C" }).items.length, 0);
});

test("A09：HTTP 100% 仍为上传中，收到照片 ID 才显示成功；终止保存待核对状态", async () => {
  let finish, aborts = 0;
  const f = fixture({ upload: (url, path, data, options) => {
    options.onProgress({ progress: 100 });
    const pending = new Promise((resolve) => { finish = resolve; });
    pending.abort = () => { aborts++; };
    return pending;
  } });
  const session = f.make(); session.add(files(1));
  const running = session.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.items[0].progress, 100); assert.equal(session.items[0].state, "uploading");
  assert.equal(session.snapshot().savedCount, 0);
  session.stop(); assert.equal(aborts, 1); assert.equal(session.items[0].state, "checking");
  finish({ id: "confirmed-late" }); await running;
  assert.equal(f.make().items[0].photoId, "confirmed-late");
});

test("A03：墓碑不会被重新上传；重放冲突不自动换编号", async () => {
  const f = fixture(); const session = f.make(); session.add(files(1));
  session.items[0].attempted = true;
  f.receipts[session.items[0].requestId] = { status: "deleted", photoId: "gone" };
  assert.equal((await session.run()).deletedCount, 1);
  assert.equal(f.attempts.length, 0);
});

test("A09：压缩失败时仍检查字节上限；小文件按真实格式上传", async () => {
  global.wx = {
    getImageInfo: ({ success }) => success({ type: "png", width: 32, height: 32 }),
    compressImage: ({ fail }) => fail(),
    getFileInfo: ({ success }) => success({ size: 3000000 })
  };
  await assert.rejects(preparePhoto({ tempFilePath: "original" }), /2.5MB/);
  global.wx.getFileInfo = ({ success }) => success({ size: 120 });
  const prepared = await preparePhoto({ tempFilePath: "original" });
  assert.equal(prepared.path, "original"); assert.ok(prepared.name.endsWith(".png"));
  delete global.wx;
});

test("退出登录清理草稿，迟到的上传响应不能把旧账号草稿重新写回", async () => {
  const f = fixture(); const session = f.make(); session.add(files(1));
  global.wx = { getStorageInfoSync: () => ({ keys: Object.keys(f.storage) }), removeStorageSync: (key) => { delete f.storage[key]; } };
  clearRecordDrafts();
  await session.run();
  assert.equal(Object.keys(f.storage).length, 0);
  assert.equal(f.attempts.length, 0);
  delete global.wx;
});

test("重选期间旧请求成功，回执只确认旧照片，不把新选照片显示为已上传", async () => {
  const f = fixture(); const session = f.make(); session.add(files(1));
  const item = session.items[0]; item.attempted = true; item.state = "checking";
  session.replace(item.requestId, { path: "new-selection", name: "new.jpg" });
  f.receipts[item.requestId] = { status: "saved", photo: { id: "old-photo" } };
  await session.run();
  assert.equal(item.photoId, "old-photo"); assert.equal(item.path, "temp-0");
  assert.match(item.error, /尚未上传/); assert.equal(f.attempts.length, 0);
});

test("返回页面创建新队列后，旧核对响应不能覆盖新队列持久状态", async () => {
  let finish;
  const f = fixture({ request: () => new Promise((resolve) => { finish = resolve; }) });
  const old = f.make(); old.add(files(1)); old.items[0].attempted = true; old.stop();
  const pending = old.reconcile();
  const current = f.make(); current.add([{ path: "second", name: "second.jpg" }]);
  finish({ status: "saved", photo: { id: "late" } }); await pending;
  assert.equal(f.make().items.length, 2);
});
