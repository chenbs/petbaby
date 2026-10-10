/**
 * t-wallet-sheet：冻干「零食柜」充值面板（2026-10-08 定稿，见 docs/ui-refactor/2026-10-06-鸡胸肉付费UI/preview.html）。
 *
 * 余额不足时由页面打开（services/wallet.js 的 walletSheetMethods.openWalletSheet）。
 * - 新用户：首充横幅「6 元到账 12 颗，白送 6 颗」单独突出并默认选中；
 * - 四档宫格每档标「多送 N%」、拆成「本金 + 送」、配加送进度条与「约 N 折」；
 * - 默认选中能补足差额的最小档，补不足的档变淡并标「这次不够」；
 * - 不加送的 6 元档收在最下面一行。
 * 付款成功触发 paid（detail.balance 为最新余额），页面据此重放原请求；关闭触发 close。
 */
const wallet = require("../../services/wallet");
const theme = require("../../theme/manager");

Component({
  properties: {
    visible: { type: Boolean, value: false, observer(value) { if (value) this.load(); } },
    required: { type: Number, value: 0 },
    balance: { type: Number, value: 0 },
    shortfall: { type: Number, value: 0 },
    /** 纪念场景：只给一行文字入口，不推销（35 号文 5.1） */
    quiet: { type: Boolean, value: false }
  },
  data: { themeId: "pet", loading: false, paying: false, error: "", first: null, tiers: [], plainPack: null, selectedId: "", notice: "", selected: null },
  attached() { this.setData({ themeId: theme.getThemeId() }); },
  methods: {
    load() {
      this.setData({ loading: true, error: "", themeId: theme.getThemeId() });
      wallet.listPackages().then((data) => {
        const view = wallet.decoratePackages(this.data.quiet ? Object.assign({}, data, { first: null }) : data, this.data.shortfall);
        this.setData(Object.assign({ loading: false }, view));
        this.syncSelected();
      }).catch((error) => this.setData({ loading: false, error: error.message }));
    },
    syncSelected() {
      const all = [].concat(this.data.first ? [this.data.first] : [], this.data.tiers, this.data.plainPack ? [this.data.plainPack] : []);
      const selected = all.find((item) => item.id === this.data.selectedId) || null;
      this.setData({ selected });
    },
    choose(event) {
      if (this.data.paying) return;
      this.setData({ selectedId: event.currentTarget.dataset.id, error: "" });
      this.syncSelected();
    },
    pay() {
      const selected = this.data.selected;
      if (!selected || this.data.paying) return;
      this.setData({ paying: true, error: "" });
      wallet.topup(selected.id)
        .then((latest) => { this.setData({ paying: false }); this.triggerEvent("paid", { balance: latest && latest.balance }); })
        .catch((error) => this.setData({ paying: false, error: error.message }));
    },
    close() { if (!this.data.paying) this.triggerEvent("close"); },
    openNotice() { wx.showModal({ title: "充值须知", content: this.data.notice || "冻干仅限本小程序使用，不可提现或转让。", showCancel: false, confirmText: "知道了" }); },
    noop() {}
  }
});
