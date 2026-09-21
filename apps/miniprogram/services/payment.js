const api = require("./api");
const inflight = {};
const paths = { work: "/api/orders/", growth: "/api/growth-orders/", physical: "/api/physical-orders/" };

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function refreshLogin() {
  return new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
    .then((result) => api.request("/api/auth/wechat", { method: "POST", data: { code: result.code } }))
    .then((session) => wx.setStorageSync("petbaby_session", session.sessionToken));
}

function prepare(path, retried) {
  return api.request(path + "/prepare", { method: "POST" }).catch((error) => {
    if (error.code !== "WECHAT_SESSION_EXPIRED" || retried) throw error;
    return refreshLogin().then(() => prepare(path, true));
  });
}

function invokePayment(params, path) {
  if (params.mode === "development") return api.request(path + "/pay", { method: "POST" });
  if (params.mode === "virtual") {
    if (!wx.requestVirtualPayment || !wx.canIUse || !wx.canIUse("requestVirtualPayment")) {
      return Promise.reject(new Error("当前微信版本暂不支持付款，请升级微信后重试"));
    }
    return new Promise((resolve, reject) => wx.requestVirtualPayment({
      mode: params.paymentMode, signData: params.signData, paySig: params.paySig, signature: params.signature,
      success: resolve, fail: reject
    }));
  }
  if (params.mode !== "wechat") return Promise.reject(new Error("支付方式暂不可用"));
  const data = Object.assign({}, params);
  delete data.mode;
  return new Promise((resolve, reject) => wx.requestPayment(Object.assign(data, { success: resolve, fail: reject })));
}

function poll(path, remaining) {
  return api.request(path + "/status").then((result) => {
    if (result.status === "paid") return result;
    if (result.status === "refunded") throw new Error("此订单已退款");
    if (result.status === "closed") throw new Error("此订单已关闭，请重新下单");
    if (remaining <= 0) throw new Error("支付结果确认中，请稍后在订单中查看，请勿重复付款");
    return wait(1200).then(() => poll(path, remaining - 1));
  });
}

function pay(kind, orderId) {
  if (!paths[kind] || !orderId) return Promise.reject(new Error("支付订单无效"));
  const path = paths[kind] + orderId;
  if (inflight[path]) return inflight[path];
  inflight[path] = api.request(path + "/status").then((current) => {
    if (current.status === "paid") return current;
    return prepare(path, false).then((prepared) => invokePayment(prepared.clientParams, path)).then(() => poll(path, 12));
  }).catch((error) => {
    if (error.errMsg) throw new Error(/cancel/i.test(error.errMsg) ? "已取消付款，可在订单中重试" : "付款未完成，请稍后重试并查看订单状态");
    throw error;
  }).then((result) => { delete inflight[path]; return result; }, (error) => { delete inflight[path]; throw error; });
  return inflight[path];
}

module.exports = { pay, invokePayment };
