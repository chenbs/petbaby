const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");

const RENDER_TEXT = { queued: "排队中", processing: "渲染中", succeeded: "已完成", failed: "渲染失败", cancelled: "已取消" };

themedPage({
  data: { id: "", project: null, render: null, caption: "", message: "", messageType: "info", busy: false, loading: true, renderText: "", confirmCancel: false },
  onLoad(options) { this.setData({ id: options.id }); this.load(); },
  onShow() { if (this.data.id && this.data.project) this.load(); },
  onUnload() { if (this.timer) clearTimeout(this.timer); },
  load() {
    api.request("/api/video-projects/" + this.data.id).then((project) => {
      this.setData({ project, caption: project.captions && project.captions[0] || "", loading: false });
      if (!project.current_render_id) return;
      return api.request("/api/video-renders/" + project.current_render_id).then((render) => {
        this.setData({ render, renderText: RENDER_TEXT[render.status] || render.status });
        if (["queued", "processing"].indexOf(render.status) >= 0) this.timer = setTimeout(() => this.load(), 2500);
      });
    }).catch((error) => this.setData({ message: error.message, messageType: "error", loading: false }));
  },
  inputCaption(event) { this.setData({ caption: event.detail.value }); },
  save() {
    api.request("/api/video-projects/" + this.data.id, { method: "PATCH", data: { captions: this.data.caption ? [this.data.caption] : [] } })
      .then((project) => this.setData({ project, message: "字幕已保存。", messageType: "success" }))
      .catch((error) => this.setData({ message: error.message, messageType: "error" }));
  },
  render() {
    this.setData({ busy: true, message: "" });
    api.request("/api/video-projects/" + this.data.id + "/render", { method: "POST" })
      .then((render) => { this.setData({ render, busy: false, renderText: RENDER_TEXT[render.status] || render.status }); this.timer = setTimeout(() => this.load(), 2500); })
      .catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" }));
  },
  askCancel() { this.setData({ confirmCancel: true }); },
  dismissCancel() { this.setData({ confirmCancel: false }); },
  cancel() {
    this.setData({ confirmCancel: false });
    if (!this.data.render) return;
    api.request("/api/video-renders/" + this.data.render.id + "/cancel", { method: "POST" })
      .then((render) => this.setData({ render, renderText: RENDER_TEXT[render.status] || render.status, message: "渲染已取消。", messageType: "info" }))
      .catch((error) => this.setData({ message: error.message, messageType: "error" }));
  },
  retry() {
    if (!this.data.render) return;
    api.request("/api/video-renders/" + this.data.render.id + "/retry", { method: "POST" })
      .then((render) => { this.setData({ render, renderText: RENDER_TEXT[render.status] || render.status }); this.timer = setTimeout(() => this.load(), 2500); })
      .catch((error) => this.setData({ message: error.message, messageType: "error" }));
  },
  openWork() { if (this.data.render && this.data.render.work_id) wx.navigateTo({ url: "/pages/work/work?id=" + this.data.render.work_id }); }
});
