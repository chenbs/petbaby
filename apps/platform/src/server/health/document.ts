import "server-only";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { computeWeightTrend, formatWeight, notableWeightNote, type WeightPoint } from "@/domain/weight-trend";
import { TRIAGE_DISCLAIMER } from "@/server/health/triage";

/*
 * 健康档案与年度健康报告的排版（改造项 L1 / L2，即 17 号文的 A5 / A6）。
 *
 * **这是「就医准备材料」不是「体检报告」。** 全文只做三件事：
 * 罗列用户自己录入的事实、把体重两个点相减、把分诊记录按时间列出。
 *
 * 不做的事（红线，逐条对应 16 号文 3.8）：
 * - 不给任何结论性判断（「健康状况良好」「存在肥胖风险」都不行）——
 *   那是评价，接近诊断，而这份文件很可能被拿到医院去，误导代价更大；
 * - 不出现「诊断」「确诊」「治愈」「问诊」字样（红线 1）；
 * - 不推荐药物（红线 2）—— 分诊记录里的建议已经过 `sanitizeAdvisory` 的
 *   药物后置过滤，这里只是转录，但仍复用同一份免责声明；
 * - 不对影像与化验资料下结论（红线 7）—— 本文件根本不收这类资料。
 *
 * 免责声明**印在第一页顶部**，与内容同屏、不折叠（红线 5）。
 * 竞品的通病正是免责缺位，而一份能被带去医院的 PDF 如果没有这句话，
 * 兽医会以为这是某种诊断结论。
 */

/** A4 纵向，300 DPI 下的像素尺寸。与实体印刷的 2480×3508 同口径 */
const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;

function escapeXml(value: string) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export interface HealthDocumentInput {
  petName: string;
  species: string;
  birthday?: string;
  lifeStage: string;
  /** 生成日期，YYYY-MM-DD */
  generatedOn: string;
  /** 年度报告才有；健康档案为 undefined */
  year?: number;
  weights: WeightPoint[];
  care: Array<{ kindText: string; label: string; performedOn: string; dueOn?: string }>;
  sessions: Array<{ date: string; levelText: string; summary: string }>;
}

const SPECIES_TEXT: Record<string, string> = { cat: "猫", dog: "犬", other: "宠物" };
const LIFE_STAGE_TEXT: Record<string, string> = { active: "成年", senior: "晚年", memorial: "已离开" };

/**
 * 体重折线。**只画点和线，不画「理想区间」参考带** ——
 * 参考带等于给出正常范围，而正常范围依赖品种、年龄、体型与肌肉量，
 * 不是体重数字能定的，画上去就是评价。
 */
function weightChart(points: WeightPoint[], x: number, y: number, width: number, height: number): string {
  const usable = points.slice(0, 24).reverse();
  if (usable.length < 2) return "";
  const values = usable.map((item) => item.weightGrams);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 上下各留 5% 余量，避免最高最低点贴边；全等时给一个固定跨度免除以 0
  const span = max - min || Math.max(1, max * 0.1);
  const padded = { low: min - span * 0.05, high: max + span * 0.05 };
  const range = padded.high - padded.low;
  const coords = usable.map((item, index) => {
    const px = x + (width * index) / Math.max(1, usable.length - 1);
    const py = y + height - ((item.weightGrams - padded.low) / range) * height;
    return { px, py, item };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.px.toFixed(1)} ${point.py.toFixed(1)}`).join(" ");
  const dots = coords.map((point) => `<circle cx="${point.px.toFixed(1)}" cy="${point.py.toFixed(1)}" r="5" fill="#3c6b52"/>`).join("");
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `
    <path d="${line}" fill="none" stroke="#3c6b52" stroke-width="3"/>
    ${dots}
    <text x="${x}" y="${y + height + 34}" font-family="sans-serif" font-size="22" fill="#6b7d73">${escapeXml(first.item.measuredOn)}</text>
    <text x="${x + width}" y="${y + height + 34}" font-family="sans-serif" font-size="22" fill="#6b7d73" text-anchor="end">${escapeXml(last.item.measuredOn)}</text>
    <text x="${x}" y="${y - 12}" font-family="sans-serif" font-size="22" fill="#6b7d73">${escapeXml(formatWeight(max))}</text>
    <text x="${x}" y="${y + height + 4}" font-family="sans-serif" font-size="22" fill="#6b7d73">${escapeXml(formatWeight(min))}</text>`;
}

/** 一行行的文本块。超过 `limit` 条时截断并注明 —— 静默截断会读作「就这些」 */
function textLines(items: string[], x: number, y: number, lineHeight: number, limit: number): string {
  const shown = items.slice(0, limit);
  const lines = shown.map((text, index) =>
    `<text x="${x}" y="${y + index * lineHeight}" font-family="sans-serif" font-size="26" fill="#2c3a33">${escapeXml(text)}</text>`);
  if (items.length > limit) {
    lines.push(`<text x="${x}" y="${y + shown.length * lineHeight}" font-family="sans-serif" font-size="24" fill="#6b7d73">另有 ${items.length - limit} 条未列出</text>`);
  }
  return lines.join("");
}

/**
 * 排一页健康档案 / 年度健康报告的 SVG。
 *
 * 标题措辞刻意避开「报告」二字的医学联想：叫「健康记录」与「年度健康记录」，
 * 而不是「体检报告」——「报告」在医疗语境里意味着有资质的机构给出的结论。
 */
export function buildHealthDocumentSvg(input: HealthDocumentInput): string {
  const trend = computeWeightTrend(input.weights);
  const note = notableWeightNote(trend);
  const title = input.year ? `${input.year} 年度健康记录` : "健康记录";
  const species = SPECIES_TEXT[input.species] || SPECIES_TEXT.other;
  const stage = LIFE_STAGE_TEXT[input.lifeStage] || input.lifeStage;

  const careLines = input.care.map((item) =>
    `${item.performedOn}　${item.kindText} · ${item.label}${item.dueOn ? `　下次 ${item.dueOn}` : ""}`);
  /*
   * 分诊记录只转录**档位与一句话结论**，不转录完整建议正文。
   * 正文里有观察指标与就医准备，那些是给当时那一刻的用户看的；
   * 印进档案会让它读起来像一份持续有效的医疗意见。
   */
  const sessionLines = input.sessions.map((item) => `${item.date}　${item.levelText}　${item.summary}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
  <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#fdfbf7"/>

  <text x="80" y="110" font-family="sans-serif" font-size="46" font-weight="700" fill="#1d2b24">${escapeXml(input.petName)}的${escapeXml(title)}</text>
  <text x="80" y="152" font-family="sans-serif" font-size="26" fill="#6b7d73">${escapeXml(species)}${input.birthday ? `　${escapeXml(input.birthday)}` : ""}　${escapeXml(stage)}　导出于 ${escapeXml(input.generatedOn)}</text>

  <!--
    免责声明在第一屏顶部、与内容同屏、不折叠（红线 5）。
    底衬用浅色块而不是纯文字：这份 PDF 会被打印出来带去医院，
    没有视觉分隔的免责声明容易被当成正文的一部分读过去。
  -->
  <rect x="80" y="188" width="${PAGE_WIDTH - 160}" height="96" rx="12" fill="#fff3e2" stroke="#e8c9a0" stroke-width="2"/>
  <text x="104" y="228" font-family="sans-serif" font-size="25" font-weight="700" fill="#8a5a20">这份记录不是诊断结论</text>
  <text x="104" y="264" font-family="sans-serif" font-size="23" fill="#8a5a20">${escapeXml(TRIAGE_DISCLAIMER)}</text>

  <text x="80" y="352" font-family="sans-serif" font-size="30" font-weight="700" fill="#1d2b24">体重</text>
  <text x="80" y="394" font-family="sans-serif" font-size="26" fill="#2c3a33">${escapeXml(trend ? trend.statement : "还没有体重记录。")}</text>
  ${note ? `<text x="80" y="430" font-family="sans-serif" font-size="24" fill="#8a5a20">${escapeXml(note)}</text>` : ""}
  ${weightChart(input.weights, 80, 470, PAGE_WIDTH - 200, 260)}

  <text x="80" y="820" font-family="sans-serif" font-size="30" font-weight="700" fill="#1d2b24">免疫与驱虫</text>
  ${careLines.length
    ? textLines(careLines, 80, 866, 40, 12)
    : `<text x="80" y="866" font-family="sans-serif" font-size="26" fill="#6b7d73">还没有记录。</text>`}

  <text x="80" y="1380" font-family="sans-serif" font-size="30" font-weight="700" fill="#1d2b24">分诊记录</text>
  ${sessionLines.length
    ? textLines(sessionLines, 80, 1426, 40, 6)
    : `<text x="80" y="1426" font-family="sans-serif" font-size="26" fill="#6b7d73">还没有记录。</text>`}

  <text x="80" y="${PAGE_HEIGHT - 60}" font-family="sans-serif" font-size="22" fill="#8b9992">由宠物造物局导出　内容来自你自己录入的记录　不替代执业兽医面诊</text>
</svg>`;
}

/**
 * SVG → PDF。
 *
 * 走「栅格化再嵌入」而不是矢量 PDF：`pdf-lib` 不解析 SVG，而这份文件的
 * 用途是打印带去医院 —— 300 DPI 的位图足够，且与 `payPhysicalOrder`
 * 的印刷链路同一条口径（那里也是 sharp 转 PNG 再嵌）。
 *
 * **不打 AI 标识**：`needsAiLabel` 只对 `generator.type === "image-api"` 为真，
 * 而这份文件是模板套用户自己录入的数据，不是生成合成内容 ——
 * 给它打标是错误标注（见 CLAUDE.md 的 AI 标识约定）。
 */
export async function renderHealthDocumentPdf(svg: string): Promise<Uint8Array> {
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  // A4 的 PDF 点尺寸（595.28×841.89），与实体印刷页同口径
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return new Uint8Array(await pdf.save());
}
