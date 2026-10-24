const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

/*
 * 隐私政策 / 用户协议 / 退款规则（2026-10-25）。
 * 正文只在服务端 domain/legal.ts 维护，经 /api/legal/<doc> 下发；端上不写正文，免得两端改漏一处。
 * 免登录可读：登录页「登录即表示同意」要能在登录前点开。
 */
const DOCS = ["privacy", "terms", "refund"];

themedPage({
  data: { loading: true, error: "", doc: null },
  onLoad(query) {
    this.docId = DOCS.indexOf(query.doc) >= 0 ? query.doc : "privacy";
    this.load();
  },
  load() {
    this.setData({ loading: true, error: "" });
    api.request("/api/legal/" + this.docId)
      .then((doc) => {
        this.setData({ doc, loading: false });
        wx.setNavigationBarTitle({ title: doc.title });
      })
      .catch((error) => this.setData({ loading: false, error: error.message || "暂时无法打开，请稍后重试" }));
  }
});
