const api = require("../../services/api");
const acquisition = require("../../services/acquisition");
const config = require("../../config");
const { themedPage } = require("../../theme/page-mixin");
const { manifest } = require("../../services/sample-assets");
const resultRevealMs = 2600;

function coverPath(cover) { return manifest.funTests[cover] || "/assets/fun-tests/" + cover + ".jpg"; }

/** 选项预先算好字母与序号：嵌套 wx:for 里的 index 在换题重建节点时取不到（实测全显示成 C、选中态也不亮）。 */
function withOptions(question) {
  if (!question) return question;
  return Object.assign({}, question, { options: (question.choices || []).map((text, index) => ({ text, index, letter: "ABCDEF".charAt(index) || String(index + 1) })) });
}

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

const POSTER = { bg: "#FFF6EC", bgDeep: "#FFE3C8", card: "#FFFFFF", ink: "#2A2140", ink2: "#6B6480", accent: "#E8603C", gold: "#F5B83D", line: "#F0DCC8", stickers: ["#FFD45C", "#CFE6FF", "#BDEBCB"] };

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

/** 圆角矩形路径（旧基础库没有 roundRect）。 */
function roundRect(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  context.lineTo(x + w, y + h - r);
  context.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  context.lineTo(x + r, y + h);
  context.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  context.lineTo(x, y + r);
  context.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  context.closePath();
}

/** 底纹：稀疏的小爪印。 */
function drawPaws(context, width, height) {
  context.setFillStyle(POSTER.bgDeep);
  for (let row = 0; row * 64 < height; row += 1) {
    for (let col = 0; col * 72 < width + 72; col += 1) {
      const x = col * 72 + (row % 2) * 36 + 18; const y = row * 64 + 26;
      context.beginPath(); context.arc(x, y + 5, 7, 0, Math.PI * 2); context.fill();
      [[-7, -5], [-2, -9], [3, -9], [8, -5]].forEach(([dx, dy]) => { context.beginPath(); context.arc(x + dx, y + dy, 2.6, 0, Math.PI * 2); context.fill(); });
    }
  }
}

/*
 * 结果海报（2026-10-26 重做）：爪印底纹 → 顶部品牌行 → 白卡（大照片 + 结果名 + 关键词贴纸 + 描述）→ 底部小程序码条。
 * 配色固定为品牌暖色，不跟随用户当前主题（海报是对外物料）。
 */
function drawPoster(context, options) {
  const { width, height, result, coverImage, petImage, codeImage } = options;
  const pad = Math.round(width * 0.06);
  context.setFillStyle(POSTER.bg);
  context.fillRect(0, 0, width, height);
  drawPaws(context, width, height);

  // 顶部品牌行
  context.setTextAlign("left");
  context.setFillStyle(POSTER.accent); context.setFontSize(13);
  context.fillText("麻麻抱我 · 宠物趣味测试", pad, pad + 10);
  context.setTextAlign("right");
  context.setFillStyle(POSTER.ink2); context.setFontSize(11);
  context.fillText(result.testTitle || "", width - pad, pad + 10);

  // 白卡
  const cardX = pad; const cardY = pad + 26; const cardW = width - pad * 2;
  const footH = 92; const cardH = height - cardY - footH - pad;
  context.save();
  context.setShadow && context.setShadow(0, 6, 16, "rgba(120,70,30,0.16)");
  context.setFillStyle(POSTER.card); roundRect(context, cardX, cardY, cardW, cardH, 18); context.fill();
  context.restore();

  // 照片：卡片上半部，圆角裁切
  const photoPad = 12; const photoX = cardX + photoPad; const photoY = cardY + photoPad;
  const photoW = cardW - photoPad * 2; const photoH = Math.round(photoW * 0.82);
  const photo = petImage || coverImage;
  context.save(); roundRect(context, photoX, photoY, photoW, photoH, 12); context.clip();
  context.setFillStyle(POSTER.bgDeep); context.fillRect(photoX, photoY, photoW, photoH);
  if (photo) drawCover(context, photo, photoX, photoY, photoW, photoH);
  context.restore();

  // 照片左下角的结果徽章
  const badge = "我的隐藏性格";
  context.setFontSize(11);
  const badgeW = badge.length * 11 + 20;
  context.setFillStyle(POSTER.gold); roundRect(context, photoX + 10, photoY + photoH - 32, badgeW, 22, 11); context.fill();
  context.setTextAlign("left"); context.setFillStyle(POSTER.ink); context.fillText(badge, photoX + 20, photoY + photoH - 17);

  // 宠物名 + 结果名
  const textX = cardX + 18; let y = photoY + photoH + 30;
  context.setFillStyle(POSTER.ink2); context.setFontSize(13);
  context.fillText((result.petName || "") + " 是一只", textX, y);
  y += 34;
  context.setFillStyle(POSTER.accent); context.setFontSize(28);
  context.fillText(result.outcome.name, textX, y);

  // 关键词贴纸（同一行，略微错落）
  y += 16;
  let stickerX = textX;
  (result.outcome.keywords || []).slice(0, 3).forEach((word, index) => {
    const label = "#" + word;
    context.setFontSize(12);
    const w = label.length * 12 + 18;
    context.save(); context.translate(stickerX, y); context.rotate(index % 2 ? 0.05 : -0.05);
    context.setFillStyle(POSTER.stickers[index]); roundRect(context, 0, 0, w, 24, 6); context.fill();
    context.setFillStyle(POSTER.ink); context.fillText(label, 9, 17);
    context.restore();
    stickerX += w + 8;
  });

  // 描述
  y += 48;
  context.setFillStyle(POSTER.ink); context.setFontSize(13);
  const textWidth = cardW - 36;
  y = drawParagraph(context, result.outcome.description, textX, y, Math.floor(textWidth / 13), 21, 3);
  if (result.outcome.closing && y + 30 < cardY + cardH) {
    context.setFillStyle(POSTER.accent); context.setFontSize(12);
    drawParagraph(context, "“" + result.outcome.closing + "”", textX, y + 8, Math.floor(textWidth / 12), 19, 1);
  }

  // 底部小程序码条
  const footY = height - footH - pad + 12;
  context.setFillStyle(POSTER.card); roundRect(context, pad, footY, width - pad * 2, footH - 12, 14); context.fill();
  const codeSize = 60; const codeX = pad + 12; const codeY = footY + (footH - 12 - codeSize) / 2;
  if (codeImage) context.drawImage(codeImage.path, codeX, codeY, codeSize, codeSize);
  const footText = codeImage ? codeX + codeSize + 12 : pad + 16;
  context.setTextAlign("left");
  context.setFillStyle(POSTER.ink); context.setFontSize(15);
  context.fillText("你家的是哪种主角？", footText, footY + 32);
  context.setFillStyle(POSTER.ink2); context.setFontSize(11);
  context.fillText("长按识别小程序码，免费测一测 · 仅供娱乐", footText, footY + 54);
}

themedPage({
  data: {
    stage: "list", tests: [], history: [], pets: [], test: null, petName: "",
    answers: [], questionIndex: 0, progress: 0, question: null, result: null, picked: -1,
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
      this.setData({ test: visibleTest(test), answers: [], questionIndex: 0, picked: -1, stage: "intro" });
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
      this.setData({ stage: "question", questionIndex: 0, picked: -1, progress: 100 / test.questions.length, question: withOptions(test.questions[0]), answers: [] });
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
    // 回到上一题时把当时选的那项亮出来，再点一次就前进
    const previousAnswer = this.data.answers[index - 1];
    this.setData({ questionIndex: index - 1, progress: index * 100 / this.data.test.questions.length, question: withOptions(this.data.test.questions[index - 1]), picked: typeof previousAnswer === "number" ? previousAnswer : -1, error: "" });
  },
  async chooseAnswer(event) {
    if (this.data.busy || this._advancing) return;
    const index = Number(event.currentTarget.dataset.index);
    const test = this.data.test;
    const current = this.data.questionIndex;
    const answers = this.data.answers.slice();
    answers[current] = index;
    // 先亮出选中项，停一小会儿再换题（新题节点按题号重建，自带滑入动画）
    this.setData({ answers, picked: index, error: "" });
    if (current < test.questions.length - 1) {
      this._advancing = true;
      setTimeout(() => {
        this._advancing = false;
        this.setData({ questionIndex: current + 1, progress: (current + 2) * 100 / test.questions.length, question: withOptions(test.questions[current + 1]), picked: -1 });
      }, 260);
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
   * 结果海报（2026-09 改版，2026-10-26 重做版式见 drawPoster）：宠物照片 + 结果名 + 关键词贴纸 + 小程序码。
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
      const height = Math.round(width * 16 / 9);
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
      path: acquisition.withInvite("/pages/fun-tests/fun-tests?shareToken=" + result.shareToken),
      imageUrl: coverPath(result.cover)
    };
    return { title: "测测你家宠物的小秘密", path: acquisition.withInvite("/pages/fun-tests/fun-tests") };
  },
  onShareTimeline() {
    const shared = this.onShareAppMessage();
    return { title: shared.title, query: shared.path.split("?")[1] || "", imageUrl: shared.imageUrl };
  }
});
