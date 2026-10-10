/**
 * t-gift-dialog：新人见面礼（添加第一只宠物后弹出一次）。
 * 3 颗冻干，7 天内有效。「冻干」也是真实零食名，所以加一句说明它是这里的零食币，避免新用户以为能买实物。
 *
 * 默认按钮去单张宠物写真（2 颗）：2026-10-10「如果我是人」涨到 4 颗，见面礼不够一次，引导过去一进门就要充值。
 *
 * 新用户引导（2026-10）：从首页玩法进来建档时，按钮改成「继续」并由页面决定去向（action-url 置空），
 * 不能再跳默认去向，否则用户回不到刚才点的那款玩法。close 事件的 detail.action 区分点按钮与点 ×。
 */
const theme = require("../../theme/manager");

Component({
  properties: {
    visible: { type: Boolean, value: false },
    units: { type: Number, value: 3 },
    actionText: { type: String, value: "去拍一张写真" },
    actionUrl: { type: String, value: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo" }
  },
  data: { themeId: "pet" },
  attached() { this.setData({ themeId: theme.getThemeId() }); },
  methods: {
    close() { this.triggerEvent("close", { action: false }); },
    go() {
      this.triggerEvent("close", { action: true });
      if (this.data.actionUrl) wx.navigateTo({ url: this.data.actionUrl });
    },
    noop() {}
  }
});
