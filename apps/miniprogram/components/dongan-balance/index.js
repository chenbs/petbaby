/**
 * t-dongan-balance：冻干余额胶囊。点击进钱包页（余额、赠送到期、收支明细、充值）。
 * 余额由页面传入（walletBalance），不在组件里各自拉一遍接口。
 */
const theme = require("../../theme/manager");

Component({
  properties: { balance: { type: Number, value: 0 }, loaded: { type: Boolean, value: true } },
  data: { themeId: "pet" },
  attached() { this.setData({ themeId: theme.getThemeId() }); },
  methods: {
    open() { wx.navigateTo({ url: "/pages/wallet/wallet" }); }
  }
});
