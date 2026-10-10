const wallet = require("../../services/wallet");
const { themedPage } = require("../../theme/page-mixin");

/**
 * 我的冻干：余额、赠送所得最近到期、收支明细、充值入口（2026-10-08）。
 * 充值复用零食柜面板；这里打开时没有「这次需要」，所以只展示档位。
 */
function dateText(iso) {
  const date = new Date(iso);
  const pad = (value) => (value < 10 ? "0" + value : "" + value);
  return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

themedPage(Object.assign({
  data: { loading: true, error: "", wallet: null, expiryText: "", items: [], cursor: "", loadingMore: false, walletSheet: { visible: false, required: 0, balance: 0, shortfall: 0 } },
  onShow() { this.load(); },
  load() {
    this.setData({ loading: true, error: "" });
    Promise.all([wallet.getWallet(), wallet.listLedger()])
      .then(([info, ledger]) => this.setData({
        loading: false,
        wallet: info,
        expiryText: info.nextGiftExpiry ? "其中赠送 " + info.giftBalance + " 颗，" + info.nextGiftExpiry.units + " 颗将于 " + dateText(info.nextGiftExpiry.expiresAt).slice(0, 5) + " 到期" : "",
        items: this.decorate(ledger.items),
        cursor: ledger.nextCursor || ""
      }))
      .catch((error) => this.setData({ loading: false, error: error.message }));
  },
  decorate(items) {
    return (items || []).map((item) => Object.assign({}, item, { deltaText: (item.delta > 0 ? "+" : "−") + Math.abs(item.delta), plus: item.delta > 0, timeText: dateText(item.createdAt) }));
  },
  onReachBottom() {
    if (!this.data.cursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    wallet.listLedger(this.data.cursor)
      .then((ledger) => this.setData({ items: this.data.items.concat(this.decorate(ledger.items)), cursor: ledger.nextCursor || "", loadingMore: false }))
      .catch(() => this.setData({ loadingMore: false }));
  },
  openTopup() {
    const balance = this.data.wallet ? this.data.wallet.balance : 0;
    this.setData({ walletSheet: { visible: true, required: 0, balance, shortfall: 0 } });
  },
  onWalletSheetClose() { this.setData({ "walletSheet.visible": false }); },
  onWalletPaid() {
    this.setData({ "walletSheet.visible": false });
    wx.showToast({ title: "冻干已到账", icon: "success" });
    this.load();
  }
}));
