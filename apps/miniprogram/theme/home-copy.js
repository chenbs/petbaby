/**
 * 首页模块在四套主题下的说法（themes.html 3.3，2026-10）。
 * 模块和顺序四套一致，只换口吻：手账「翻开看看」、赛博「启动转生」、影院「入场」。
 * 首页与主题选择页的缩略图共用这一份，避免两处文案漂移。
 */
const HOME_COPY = {
  pet: { eyebrow: "款人像造型 · 一键变身", go: "去变身", tag: "", note: "麻麻每周挑的" },
  film: { eyebrow: "款人像造型 · 贴进相册", go: "翻开看看", tag: "", note: "这一页是麻麻贴的" },
  brand: { eyebrow: "款人像造型 · 一键变身", go: "启动转生", tag: "● 转生程序就绪", note: "本周热门 01–08" },
  night: { eyebrow: "款人像造型 · 一键变身", go: "入场", tag: "正在上映", note: "导演精选片单" }
};

module.exports = { HOME_COPY };
