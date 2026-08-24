const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");
const scenes = require("../../theme/scene-presets");

const EXPORT_TEXT = { queued: "排队中", processing: "生成中", succeeded: "已完成", failed: "导出失败" };

themedPage({
  data: {
    session: null, publicMode: false, photos: [], photoIds: [],
    title: "", copy: "", theme: "stardust", stardust: 0,
    scenePresets: scenes.SCENE_PRESETS, sceneStyle: scenes.getSceneStyle("stardust"),
    busy: false, message: "", messageType: "info", loading: true, exportText: "", editing: false, confirmRevoke: false
  },
  onLoad(query) { this.sessionId = query.id; this.token = query.token; this.source = query.source || "miniprogram-share"; this.visitorKey = wx.getStorageSync("petbaby_interactive_visitor") || (Date.now() + "-" + Math.random()); wx.setStorageSync("petbaby_interactive_visitor", this.visitorKey); this.load(); },
  onUnload() { if (this.timer) clearTimeout(this.timer); if (this.data.publicMode && this.startedAt) api.request("/api/interactive-share/" + this.token, { method: "POST", data: { name: "duration", visitorKey: this.visitorKey, source: this.source, durationMs: Date.now() - this.startedAt, payload: {} } }).catch(() => undefined); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  load() {
    const path = this.token ? "/api/interactive-share/" + this.token : "/api/interactive-sessions/" + this.sessionId;
    return api.request(path).then((session) => {
      const snapshot = session.snapshot || {};
      const theme = snapshot.theme || "stardust";
      this.setData({
        session,
        publicMode: Boolean(this.token),
        photoIds: session.photoIds || [],
        title: snapshot.title || "",
        copy: snapshot.copy || "",
        theme,
        sceneStyle: scenes.getSceneStyle(theme),
        stardust: Number(snapshot.stardust || 0),
        loading: false,
        exportText: session.exportStatus ? EXPORT_TEXT[session.exportStatus] || session.exportStatus : ""
      });
      if (!this.token) api.request("/api/photos?petId=" + encodeURIComponent(session.petId)).then((photos) => this.setData({ photos: photos.map((photo) => Object.assign({}, photo, { selected: (session.photoIds || []).indexOf(photo.id) >= 0 })) }));
      if (this.token && !this.startedAt) { this.startedAt = Date.now(); api.request(path, { method: "POST", data: { name: "visit", visitorKey: this.visitorKey, source: this.source, payload: {} } }).catch(() => undefined); }
      if (!this.token && (session.exportStatus === "queued" || session.exportStatus === "processing")) this.timer = setTimeout(() => this.load(), 1600);
      return session;
    }).catch((error) => this.setData({ message: error.message, messageType: "error", loading: false }));
  },
  inputTitle(event) { this.setData({ title: event.detail.value }); },
  inputCopy(event) { this.setData({ copy: event.detail.value }); },
  chooseScene(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ theme: id, sceneStyle: scenes.getSceneStyle(id) });
  },
  toggleEditing() { this.setData({ editing: !this.data.editing }); },
  togglePhoto(event) {
    const id = event.detail.id;
    const ids = this.data.photoIds.slice();
    const index = ids.indexOf(id);
    if (index >= 0) ids.splice(index, 1);
    else if (ids.length < 6) ids.push(id);
    else return this.setData({ message: "最多保留 6 张场景照片。", messageType: "info" });
    this.setData({ photoIds: ids, photos: this.data.photos.map((photo) => Object.assign({}, photo, { selected: ids.indexOf(photo.id) >= 0 })) });
  },
  save() {
    if (!this.data.photoIds.length) return this.setData({ message: "至少保留一张场景照片。", messageType: "error" });
    this.setData({ busy: true });
    api.request("/api/interactive-sessions/" + this.sessionId, { method: "PATCH", data: { photoIds: this.data.photoIds, snapshot: { title: this.data.title, copy: this.data.copy, theme: this.data.theme, stardust: this.data.stardust } } })
      .then((session) => this.setData({ session, busy: false, editing: false, message: "场景已保存。", messageType: "success" }))
      .catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" }));
  },
  addStar() { const next = this.data.stardust + 1; this.setData({ stardust: next }); if (this.token) api.request("/api/interactive-share/" + this.token, { method: "POST", data: { name: "stardust_collected", visitorKey: this.visitorKey, source: this.source, payload: { count: next } } }).catch(() => undefined); else this.save(); },
  share() { api.request("/api/interactive-sessions/" + this.sessionId + "/share", { method: "POST", data: { expiresInHours: 168 } }).then((session) => { this.setData({ session, message: "分享已开启 7 天，链接已复制。", messageType: "success" }); wx.setClipboardData({ data: config.apiBaseUrl + session.sharePath }); }); },
  askRevoke() { this.setData({ confirmRevoke: true }); },
  dismissRevoke() { this.setData({ confirmRevoke: false }); },
  revoke() {
    this.setData({ confirmRevoke: false });
    api.request("/api/interactive-sessions/" + this.sessionId + "/revoke-share", { method: "POST" })
      .then((session) => this.setData({ session, message: "已停止分享。", messageType: "info" }))
      .catch((error) => this.setData({ message: error.message, messageType: "error" }));
  },
  exportVideo() { this.setData({ busy: true }); api.request("/api/interactive-sessions/" + this.sessionId + "/export", { method: "POST" }).then((session) => { this.setData({ session, busy: false, exportText: EXPORT_TEXT[session.exportStatus] || session.exportStatus, message: "15 秒 MP4 已进入队列。", messageType: "info" }); this.timer = setTimeout(() => this.load(), 1600); }).catch((error) => this.setData({ busy: false, message: error.message, messageType: "error" })); },
  openWork() { const session = this.data.session; if (session && session.workId) wx.navigateTo({ url: "/pages/work/work?id=" + session.workId }); },
  onShareAppMessage() { const session = this.data.session; const token = session && session.shareToken; return { title: this.data.title || "宠物互动页", path: token ? "/pages/interactive/interactive?token=" + token + "&source=miniprogram-share" : "/pages/interactive/interactive?id=" + this.sessionId }; }
});
