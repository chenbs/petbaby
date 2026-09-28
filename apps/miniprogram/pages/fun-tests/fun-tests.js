const api = require("../../services/api");
const config = require("../../config");
const theme = require("../../theme/manager");
const { themedPage } = require("../../theme/page-mixin");

function coverPath(cover) { return "/assets/fun-tests/" + cover + ".jpg"; }

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

themedPage({
  data: {
    stage: "list", tests: [], history: [], pets: [], test: null, petName: "",
    answers: [], questionIndex: 0, progress: 0, question: null, result: null,
    ownResult: false, loading: true, busy: false, error: ""
  },
  onLoad(query) {
    if (query.shareToken) this.loadShared(query.shareToken);
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
        this.setData({ error: "请先登录，再来测测它" });
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
    this.setData({ busy: true });
    try {
      const result = await api.request("/api/fun-tests/" + encodeURIComponent(test.id), {
        method: "POST", data: { petName: this.data.petName.trim(), answers }
      });
      this.setData({ result, stage: "result", ownResult: true, history: [result].concat(this.data.history) });
    } catch (error) { this.setData({ error: error.message }); }
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
  savePoster() {
    const result = this.data.result;
    if (!result || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    const width = Math.round(wx.getSystemInfoSync().windowWidth * 0.8);
    const height = Math.round(width * 5 / 3);
    const colors = theme.getTheme();
    const context = wx.createCanvasContext("funTestPoster", this);
    context.setFillStyle(colors.navBarBackground);
    context.fillRect(0, 0, width, height);
    context.setFillStyle(colors.primary);
    context.fillRect(0, 0, width, 12);
    context.setFontSize(13);
    context.fillText("麻麻抱我 · 宠物趣味测试", 24, 43);
    context.setFillStyle(colors.textPrimary);
    context.setFontSize(17);
    drawParagraph(context, result.petName + "的测试结果", 24, 91, Math.floor((width - 48) / 17), 22, 2);
    context.setFontSize(27);
    let y = drawParagraph(context, result.outcome.name, 24, 136, 10, 33, 2);
    context.setFontSize(14);
    y = drawParagraph(context, result.outcome.description, 24, y + 20, Math.floor((width - 48) / 14), 23, 4);
    context.setFillStyle(colors.primary);
    context.fillRect(24, y + 6, width - 48, 1);
    context.setFontSize(13);
    y = drawParagraph(context, result.outcome.closing, 24, y + 34, Math.floor((width - 48) / 13), 21, 3);
    context.setFillStyle(colors.textSecondary);
    context.setFontSize(11);
    context.fillText(result.outcome.keywords.map((word) => "#" + word).join("  "), 24, Math.min(y + 25, height - 57));
    context.fillText("仅供娱乐 · 转发结果邀请朋友来测", 24, height - 25);
    context.draw(false, () => {
      wx.canvasToTempFilePath({ canvasId: "funTestPoster", destWidth: width * 3, destHeight: height * 3,
        success: (file) => wx.saveImageToPhotosAlbum({ filePath: file.tempFilePath,
          success: () => wx.showToast({ title: "海报已保存" }),
          fail: () => { this.setData({ error: "保存失败，请在小程序设置中允许保存到相册" }); wx.previewImage({ urls: [file.tempFilePath] }); },
          complete: () => this.setData({ busy: false })
        }),
        fail: () => this.setData({ busy: false, error: "海报生成失败，请重试" })
      }, this);
    });
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
