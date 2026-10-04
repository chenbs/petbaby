const api = require("../../services/api");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");
const { manifest } = require("../../services/sample-assets");
const resultRevealMs = 2600;

function coverPath(cover) { return manifest.funTests[cover] || "/assets/fun-tests/" + cover + ".jpg"; }

function visibleTest(test) {
  return Object.assign({}, test, { coverPath: coverPath(test.cover) });
}

function drawParagraph(context, text, x, y, maxChars, lineHeight, maxLines) {
  const chars = Array.from(text || "");
  const lines = [];
  while (chars.length && lines.length < maxLines) lines.push(chars.splice(0, maxChars).join(""));
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

const POSTER = { bg: "#FFFAF3", band: "#FFD0A1", ink: "#1F2540", ink2: "#5B6178", accent: "#B7401A", stickers: ["#FFD45C", "#CFE6FF", "#BDEBCB"] };

/** 取得海报可用的本地图片（含尺寸）。任何一步失败都返回 null，海报照样能画，只是少一张图。 */
function posterImage(src, withSession) {
  const info = (path) => new Promise((resolve) => wx.getImageInfo({ src: path, success: (image) => resolve({ path, width: image.width, height: image.height }), fail: () => resolve(null) }));
  if (!src) return Promise.resolve(null);
  if (src.indexOf("/assets/") === 0) return info(src);
  return new Promise((resolve) => wx.downloadFile({
    url: src,
    header: withSession ? { authorization: "Bearer " + wx.getStorageSync("petbaby_session"), "x-petbaby-client": "miniprogram" } : {},
    success: (result) => resolve(result.statusCode === 200 ? info(result.tempFilePath) : null),
    fail: () => resolve(null)
  }));
}

/** 按 cover 方式把图片画进指定区域（居中裁切，不拉伸）。 */
function drawCover(context, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale; const sh = h / scale;
  context.drawImage(image.path, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

function drawPoster(context, options) {
  const { width, height, result, coverImage, petImage, codeImage } = options;
  const band = Math.round(height * 0.44);
  context.setFillStyle(POSTER.bg);
  context.fillRect(0, 0, width, height);
  context.setFillStyle(POSTER.band);
  context.fillRect(0, 0, width, band);
  if (coverImage) { context.setGlobalAlpha(0.28); drawCover(context, coverImage, 0, 0, width, band); context.setGlobalAlpha(1); }
  const radius = Math.round(width * 0.24); const cx = width / 2; const cy = Math.round(band * 0.5);
  if (petImage) {
    context.save(); context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.clip();
    drawCover(context, petImage, cx - radius, cy - radius, radius * 2, radius * 2);
    context.restore();
  }
  context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.setStrokeStyle("#FFFFFF"); context.setLineWidth(6); context.stroke();
  const spots = [[0.1, 0.16, -0.14], [0.66, 0.26, 0.12], [0.16, 0.72, 0.09]];
  (result.outcome.keywords || []).slice(0, 3).forEach((word, index) => {
    const label = "#" + word; const [px, py, angle] = spots[index];
    context.setFontSize(12);
    const w = label.length * 12 + 20;
    context.save(); context.translate(width * px, band * py); context.rotate(angle);
    context.setFillStyle(POSTER.stickers[index]); context.fillRect(0, 0, w, 24);
    context.setFillStyle(POSTER.ink); context.fillText(label, 10, 17);
    context.restore();
  });
  context.setTextAlign("center");
  context.setFillStyle(POSTER.ink2); context.setFontSize(12);
  context.fillText("经过 10 道题，" + result.petName + "的隐藏性格是", cx, band + 30);
  context.setFillStyle(POSTER.accent); context.setFontSize(28);
  context.fillText(result.outcome.name, cx, band + 68);
  context.setTextAlign("left");
  context.setFillStyle(POSTER.ink); context.setFontSize(13);
  const textWidth = width - 40;
  let y = drawParagraph(context, result.outcome.description, 20, band + 98, Math.floor(textWidth / 13), 21, 3);
  context.setFillStyle(POSTER.ink2); context.setFontSize(12);
  drawParagraph(context, result.outcome.closing, 20, y + 10, Math.floor(textWidth / 12), 19, 2);
  const footTop = height - 86;
  context.setStrokeStyle("#E9D6C2"); context.setLineWidth(1); context.setLineDash && context.setLineDash([4, 4]);
  context.beginPath(); context.moveTo(20, footTop); context.lineTo(width - 20, footTop); context.stroke();
  context.setLineDash && context.setLineDash([]);
  const codeSize = 62;
  if (codeImage) context.drawImage(codeImage.path, 20, footTop + 12, codeSize, codeSize);
  const textX = codeImage ? 20 + codeSize + 12 : 20;
  context.setFillStyle(POSTER.ink); context.setFontSize(14);
  context.fillText("你家的是哪种主角？", textX, footTop + 38);
  context.setFillStyle(POSTER.ink2); context.setFontSize(11);
  context.fillText("长按识别，免费测一测 · 仅供娱乐", textX, footTop + 60);
}

themedPage({
  data: {
    stage: "list", tests: [], history: [], pets: [], test: null, petName: "",
    answers: [], questionIndex: 0, progress: 0, question: null, result: null,
    ownResult: false, loading: true, busy: false, error: ""
  },
  onLoad(query) {
    // resultId：从作品柜「趣测」直达某一次结果（2026-09 作品柜收纳趣测结果）。
    this._openResultId = query.resultId || "";
    // 扫海报上的小程序码进入时，分享 token 在 scene 里（微信 scene 上限 32 字符）。
    const scene = query.scene ? decodeURIComponent(query.scene) : "";
    if (query.shareToken || scene) this.loadShared(query.shareToken || scene);
    else this.load();
  },
  async load() {
    this.setData({ loading: true, error: "", stage: "list" });
    try {
      const tests = await api.request("/api/fun-tests");
      this.setData({ tests: tests.map(visibleTest), loading: false });
      Promise.all([
        api.request("/api/pets").catch(() => []),
        api.request("/api/fun-test-results").catch(() => [])
      ]).then((values) => {
        const pets = values[0];
        const preferred = pets.find((pet) => pet.isDefault) || pets[0];
        this.setData({ pets, history: values[1], petName: this.data.petName || (preferred && preferred.name) || "" });
        if (this._openResultId) {
          const saved = (values[1] || []).find((item) => item.id === this._openResultId);
          this._openResultId = "";
          if (saved) this.setData({ result: saved, stage: "result", ownResult: true, error: "" });
        }
      });
    } catch (error) { this.setData({ loading: false, error: error.message }); }
  },
  async loadShared(token) {
    this.setData({ loading: true, error: "", ownResult: false });
    try {
      const result = await api.request("/api/fun-test-share/" + encodeURIComponent(token));
      this.setData({ result, stage: "result", loading: false });
    } catch (error) { this.setData({ error: error.message, stage: "share-error", loading: false }); }
  },
  async openTest(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ busy: true, error: "" });
    try {
      const test = await api.request("/api/fun-tests/" + encodeURIComponent(id));
      this.setData({ test: visibleTest(test), answers: [], questionIndex: 0, stage: "intro" });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  choosePet(event) {
    const pet = this.data.pets[Number(event.currentTarget.dataset.index)];
    if (pet) this.setData({ petName: pet.name });
  },
  nameInput(event) { this.setData({ petName: event.detail.value }); },
  async start() {
    if (!this.data.petName.trim()) return this.setData({ error: "先写下宠物的名字" });
    const test = this.data.test;
    this.setData({ busy: true, error: "" });
    try {
      await api.request("/api/fun-tests/" + encodeURIComponent(test.id) + "/start", { method: "POST", data: {} });
      this.setData({ stage: "question", questionIndex: 0, progress: 100 / test.questions.length, question: test.questions[0], answers: [] });
    } catch (error) {
      if (error.statusCode === 401) {
        this.setData({ error: "请先登录，再来测测我" });
        wx.navigateTo({ url: "/pages/login/login" });
      } else this.setData({ error: error.message });
    } finally { this.setData({ busy: false }); }
  },
  previous() {
    const index = this.data.questionIndex;
    if (!index) return this.setData({ stage: "intro", error: "" });
    this.setData({ questionIndex: index - 1, progress: index * 100 / this.data.test.questions.length, question: this.data.test.questions[index - 1], error: "" });
  },
  async chooseAnswer(event) {
    if (this.data.busy) return;
    const index = Number(event.currentTarget.dataset.index);
    const test = this.data.test;
    const current = this.data.questionIndex;
    const answers = this.data.answers.slice();
    answers[current] = index;
    this.setData({ answers, error: "" });
    if (current < test.questions.length - 1) {
      this.setData({ questionIndex: current + 1, progress: (current + 2) * 100 / test.questions.length, question: test.questions[current + 1] });
      return;
    }
    this.setData({ busy: true, stage: "thinking" });
    const revealDelay = new Promise((resolve) => setTimeout(resolve, resultRevealMs));
    try {
      const result = await api.request("/api/fun-tests/" + encodeURIComponent(test.id), {
        method: "POST", data: { petName: this.data.petName.trim(), answers }
      });
      await revealDelay;
      this.setData({ result, stage: "result", ownResult: true, history: [result].concat(this.data.history) });
    } catch (error) { this.setData({ stage: "question", error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  openSaved(event) {
    const result = this.data.history.find((item) => item.id === event.currentTarget.dataset.id);
    if (result) this.setData({ result, stage: "result", ownResult: true, error: "" });
  },
  retry() {
    const result = this.data.result;
    if (!result) return this.load();
    this.openTest({ currentTarget: { dataset: { id: result.testId } } });
  },
  backToList() { this.load(); },
  copyLink() {
    if (!this.data.result) return;
    wx.setClipboardData({ data: config.apiBaseUrl + "/fun-tests/share/" + this.data.result.shareToken });
  },
  deleteResult() {
    const result = this.data.result;
    if (!result || !this.data.ownResult) return;
    wx.showModal({
      title: "删除测试结果？", content: "删除后，已分享的链接也会失效。",
      success: async (modal) => {
        if (!modal.confirm) return;
        this.setData({ busy: true, error: "" });
        try {
          await api.request("/api/fun-test-results/" + result.id, { method: "DELETE" });
          this.setData({ history: this.data.history.filter((item) => item.id !== result.id), result: null, stage: "list" });
        } catch (error) { this.setData({ error: error.message }); }
        finally { this.setData({ busy: false }); }
      }
    });
  },
  /*
   * 结果海报（2026-09 改版）：宠物照片 + 结果名 + 三个关键词贴纸 + 小程序码。
   * 原海报只有文字，发到朋友圈没有照片、也扫不进小程序，拉新能力几乎为零。
   * 海报是品牌物料，配色固定为橘子汽水，不跟随用户当前主题。
   */
  async savePoster() {
    const result = this.data.result;
    if (!result || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      const pet = (this.data.pets || []).find((item) => item.name === result.petName && item.avatarUrl);
      const [coverImage, petImage, codeImage] = await Promise.all([
        posterImage(coverPath(result.cover)),
        pet ? posterImage(config.apiBaseUrl + pet.avatarUrl, true) : Promise.resolve(null),
        result.shareToken ? posterImage(config.apiBaseUrl + "/api/fun-test-share/" + encodeURIComponent(result.shareToken) + "/code") : Promise.resolve(null)
      ]);
      const width = Math.round(wx.getSystemInfoSync().windowWidth * 0.8);
      const height = Math.round(width * 5 / 3);
      const context = wx.createCanvasContext("funTestPoster", this);
      drawPoster(context, { width, height, result, coverImage, petImage: petImage || coverImage, codeImage });
      await new Promise((resolve) => context.draw(false, resolve));
      const file = await new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvasId: "funTestPoster", destWidth: width * 3, destHeight: height * 3, success: resolve, fail: reject }, this));
      await new Promise((resolve) => wx.saveImageToPhotosAlbum({
        filePath: file.tempFilePath,
        success: () => { wx.showToast({ title: "海报已保存" }); resolve(); },
        fail: () => { this.setData({ error: "保存失败，请在小程序设置中允许保存到相册" }); wx.previewImage({ urls: [file.tempFilePath] }); resolve(); }
      }));
    } catch (error) {
      this.setData({ error: "海报生成失败，请重试" });
    } finally {
      this.setData({ busy: false });
    }
  },
  onShareAppMessage() {
    const result = this.data.result;
    if (this.data.stage === "result" && result) return {
      title: result.petName + "是" + result.outcome.name + "，来看看你的宠物",
      path: "/pages/fun-tests/fun-tests?shareToken=" + result.shareToken,
      imageUrl: coverPath(result.cover)
    };
    return { title: "测测你家宠物的小秘密", path: "/pages/fun-tests/fun-tests" };
  },
  onShareTimeline() {
    const shared = this.onShareAppMessage();
    return { title: shared.title, query: shared.path.split("?")[1] || "", imageUrl: shared.imageUrl };
  }
});
