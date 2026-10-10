/**
 * 冻干钱包（2026-10-08，docs/product/36-冻干钱包与会员下线实施方案.md）。
 *
 * 付费玩法一律「先扣冻干，再执行任务」。余额不足时服务端返回 402 WALLET_INSUFFICIENT，
 * details 带 required / balance / shortfall。页面统一走 withDongan()：
 *   1. 调原请求；
 *   2. 遇到 402 → 弹零食柜面板（t-wallet-sheet）→ 用户选档付款；
 *   3. 到账后用**同一个幂等键**重放原请求，等于「到账后自动开始生成」，不会重复扣。
 *
 * 用户只看到「付钱 → 到账冻干」，看不到任何代币或兑换步骤。
 */
const api = require("./api");
const payment = require("./payment");

const UNIT = "颗";
const NAME = "冻干";

function getWallet() { return api.request("/api/wallet"); }
function listLedger(before) { return api.request("/api/wallet/ledger" + (before ? "?before=" + encodeURIComponent(before) : "")); }
function listPackages() { return api.request("/api/wallet/topup-packages"); }

/** 「2 颗冻干」：只写「2 颗」读不出是什么，量词后面带上货币名 */
function costText(units) { return units + " " + UNIT + NAME; }

/** 宫格档位：给模板直接用的展示字段。默认选中能补足差额的最小档。 */
function decoratePackages(data, shortfall) {
  const packages = (data && data.packages || []).map((item) => ({
    id: item.id, amount: item.amount, units: item.units, gift: item.gift, giftPercent: item.giftPercent,
    discount: item.discount, photos: item.photos, badge: item.badge || "",
    plain: item.gift <= 0,
    baseShare: item.units ? Math.round((item.amount / item.units) * 100) : 100,
    discountText: "约 " + item.discount + " 折",
    priceText: "¥" + item.amount
  }));
  const tiers = packages.filter((item) => !item.plain);
  const plainPack = packages.find((item) => item.plain) || null;
  const need = Number(shortfall || 0);
  const covering = tiers.filter((item) => item.units >= need);
  const first = data && data.first ? { id: data.first.id, amount: data.first.amount, units: data.first.units, gift: data.first.gift, badge: data.first.badge, priceText: "¥" + data.first.amount } : null;
  return {
    first,
    tiers: tiers.map((item) => Object.assign(item, { short: need > 0 && item.units < need })),
    plainPack,
    selectedId: first && first.units >= need ? first.id : (covering[0] || tiers[tiers.length - 1] || {}).id || "",
    notice: data && data.notice || ""
  };
}

/** 创建充值单并完成支付；成功后返回最新钱包。 */
function topup(packageId) {
  return api.request("/api/wallet/topups", { method: "POST", data: { packageId } })
    .then((order) => payment.pay("growth", order.id))
    .then(() => getWallet());
}

function isInsufficient(error) { return error && error.code === "WALLET_INSUFFICIENT"; }

/**
 * 执行一个会扣冻干的请求。余额不足时调用 page.openWalletSheet(details) 等用户付款，
 * 付款成功后自动重放；用户关掉面板则以 cancelled 错误结束（调用方静默即可）。
 *
 * @param page 挂了 t-wallet-sheet 的页面（需要实现 openWalletSheet，见 wallet-sheet 组件说明）
 * @param run  无参函数，返回原请求的 Promise；重放时会再调一次，必须复用同一个幂等键
 */
function withDongan(page, run) {
  return run().catch((error) => {
    if (!isInsufficient(error) || !page || typeof page.openWalletSheet !== "function") throw error;
    return page.openWalletSheet(error.details || {}).then((paid) => {
      if (!paid) { const cancelled = new Error("已取消"); cancelled.code = "WALLET_TOPUP_CANCELLED"; throw cancelled; }
      return withDongan(page, run);
    });
  });
}

/** 页面混入：给挂了 <t-wallet-sheet> 的页面提供 openWalletSheet / onWalletSheetClose / onWalletPaid。 */
const walletSheetMethods = {
  openWalletSheet(details) {
    // 热重载可能只更新 JS，页面 JSON/WXML 仍旧，面板未挂载时不能无限等付款。
    if (typeof this.selectComponent === "function" && !this.selectComponent("#wallet-sheet")) {
      const error = new Error("充值面板暂未加载，请退出当前页面后重试");
      error.code = "WALLET_SHEET_UNAVAILABLE";
      return Promise.reject(error);
    }
    if (this._walletResolve) this._walletResolve(false);
    return new Promise((resolve) => {
      this._walletResolve = resolve;
      this.setData({ walletSheet: { visible: true, required: Number(details.required || 0), balance: Number(details.balance || 0), shortfall: Number(details.shortfall || 0) } });
    });
  },
  onWalletSheetClose() {
    this.setData({ "walletSheet.visible": false });
    const resolve = this._walletResolve; this._walletResolve = null;
    if (resolve) resolve(false);
  },
  onWalletPaid(event) {
    this.setData({ "walletSheet.visible": false, walletBalance: event.detail && event.detail.balance });
    const resolve = this._walletResolve; this._walletResolve = null;
    if (resolve) resolve(true);
  },
  refreshWallet() {
    return getWallet().then((wallet) => { this.setData({ walletBalance: wallet.balance, walletCosts: wallet.costs || {} }); return wallet; }).catch(() => null);
  }
};

module.exports = { NAME, UNIT, getWallet, listLedger, listPackages, decoratePackages, topup, withDongan, isInsufficient, costText, walletSheetMethods };
