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
  /**
   * 日常记录里的身体状况 / 用药 / 就医行（2026-10），已由 daily-log-context 转成文字。
   * 只罗列主人记下的现象，与其余各段一样不做任何归纳。
   */
  records?: string[];
}

/** 版心：左右各留 80，页脚基线在 PAGE_HEIGHT - 60，正文最后一行基线不低于 CONTENT_BOTTOM */
const CONTENT_LEFT = 80;
const CONTENT_WIDTH = PAGE_WIDTH - CONTENT_LEFT * 2;
const CONTENT_BOTTOM = PAGE_HEIGHT - 120;
/** 续页正文起点（续页只有标题与一行免责提示，没有体重段） */
const CONTINUATION_TOP = 230;

const ITEM_FONT_SIZE = 26;
/** 同一条记录折行后的行距；条与条之间仍是原来的 40 */
const WRAP_LINE_HEIGHT = 34;
const ITEM_GAP = 40;
/** 单条最多折成 3 行。再长的分诊摘要印进档案也读不完，末行以省略号收尾 */
const ITEM_MAX_LINES = 3;

/**
 * 估算单个字符的宽度（单位 em）。
 *
 * SVG 交给 sharp/librsvg 栅格化，拿不到真实字形宽度，只能按字符类别估：
 * 中文与全角符号按 1em，西文按常见无衬线字体的平均宽度取，宁宽勿窄 ——
 * 估窄了就会再次超出版心，估宽了只是行尾多留一点空。
 */
function charWidth(char: string) {
  const code = char.codePointAt(0) || 0;
  if (code >= 0x80) return 1;
  if (" .,:;'!|-()[]".includes(char)) return 0.36;
  if (/[A-Z%@&MW]/.test(char)) return 0.72;
  return 0.6;
}

function textWidth(text: string, fontSize: number) {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width * fontSize;
}

/** 不能出现在行首的标点：折行时跟着上一行走，否则行首挂一个逗号很难看 */
const NO_LINE_START = "，。、；：？！）》」』】,.;:?!)%";
/** 连续的西文 / 数字片段（日期、体重、英文药名）不从中间断开 */
const ASCII_WORD = /[A-Za-z0-9.\-:%]/;

/**
 * 按版心宽度折行。超过 `maxLines` 时末行以「…」收尾。
 *
 * 不用 `slice(0, N)` 按字数截：中西文混排时字数和宽度对不上，
 * 截短了丢信息（「复诊日期 202」），截长了照样出版心。
 */
function wrapText(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const chars = Array.from(String(text || "").replace(/\s*\r?\n\s*/g, " ").trim());
  const lines: string[] = [];
  let start = 0;
  while (start < chars.length && lines.length < maxLines) {
    let width = 0;
    let end = start;
    while (end < chars.length && width + charWidth(chars[end]) * fontSize <= maxWidth) {
      width += charWidth(chars[end]) * fontSize;
      end += 1;
    }
    if (end < chars.length) {
      // 断点落在西文片段中间：退回到片段开头（整行都是西文时只能硬断）
      if (ASCII_WORD.test(chars[end]) && ASCII_WORD.test(chars[end - 1])) {
        let back = end;
        while (back > start && ASCII_WORD.test(chars[back - 1])) back -= 1;
        if (back > start) end = back;
      }
      // 避头标点并入本行；只并一个字符，溢出不超过 1em，落在右侧留白里
      if (NO_LINE_START.includes(chars[end])) end += 1;
    }
    if (end === start) end = start + 1;
    lines.push(chars.slice(start, end).join("").trimEnd());
    start = end;
    while (start < chars.length && chars[start] === " ") start += 1;
  }
  if (start < chars.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && textWidth(`${last}…`, fontSize) > maxWidth) last = Array.from(last).slice(0, -1).join("");
    lines[lines.length - 1] = `${last.replace(/[，。、；：,.;:\s]+$/, "")}…`;
  }
  return lines;
}

function sectionTitle(text: string, y: number) {
  return `<text x="${CONTENT_LEFT}" y="${y}" font-family="sans-serif" font-size="30" font-weight="700" fill="#1d2b24">${text}</text>`;
}

function emptyLine(y: number) {
  return `<text x="${CONTENT_LEFT}" y="${y}" font-family="sans-serif" font-size="26" fill="#6b7d73">还没有记录。</text>`;
}

/** 一条记录。折成多行时用 tspan 排，行距 WRAP_LINE_HEIGHT */
function textItem(lines: string[], y: number) {
  const spans = lines.map((line, index) =>
    `<tspan x="${CONTENT_LEFT}" dy="${index ? WRAP_LINE_HEIGHT : 0}">${escapeXml(line)}</tspan>`).join("");
  return `<text x="${CONTENT_LEFT}" y="${y}" font-family="sans-serif" font-size="${ITEM_FONT_SIZE}" fill="#2c3a33">${spans}</text>`;
}

/**
 * 免疫驱虫 → 近期日常记录 → 分诊记录，三段自上而下排。
 *
 * 没有日常记录时保持原版式（免疫 12 条、分诊 6 条）；有日常记录时三段分摊同一块版面，
 * 每段都按条数截断并注明「另有 N 条未列出」。
 *
 * 长条目按版心宽度折行，页面放不下时续排到下一页，段名后标「（续）」——
 * 之前每条都是单行 `<text>`，长摘要直接被页边裁掉，末段还会压进页脚。
 */
function lowerSections(
  care: string[],
  records: string[],
  sessions: string[],
  layout: { push: (part: string) => void; newPage: () => number; isFirstPage: () => boolean },
) {
  const limits = records.length ? { care: 6, records: 8, sessions: 4 } : { care: 12, records: 0, sessions: 6 };
  let y = 820;
  const block = (title: string, lines: string[], limit: number) => {
    const items = lines.slice(0, limit).map((text) => wrapText(text, ITEM_FONT_SIZE, CONTENT_WIDTH, ITEM_MAX_LINES));
    // 段名至少带着第一条一起走，不在页底留一个孤零零的标题
    const firstSpan = items.length ? (items[0].length - 1) * WRAP_LINE_HEIGHT : 0;
    if (y + 46 + firstSpan > CONTENT_BOTTOM) y = layout.newPage();
    layout.push(sectionTitle(title, y));
    y += 46;
    const room = (span: number) => {
      if (y + span <= CONTENT_BOTTOM) return;
      y = layout.newPage();
      layout.push(sectionTitle(`${title}（续）`, y));
      y += 46;
    };
    if (!items.length) { layout.push(emptyLine(y)); y += ITEM_GAP; }
    for (const item of items) {
      const span = (item.length - 1) * WRAP_LINE_HEIGHT;
      room(span);
      layout.push(textItem(item, y));
      y += span + ITEM_GAP;
    }
    if (lines.length > limit) {
      room(0);
      // 静默截断会读作「就这些」
      layout.push(`<text x="${CONTENT_LEFT}" y="${y}" font-family="sans-serif" font-size="24" fill="#6b7d73">另有 ${lines.length - limit} 条未列出</text>`);
      y += ITEM_GAP;
    }
    y += 48;
  };
  block("免疫与驱虫", care, limits.care);
  if (records.length) block("近期日常记录", records, limits.records);
  // 原版式里分诊段固定在 1380：免疫段少时不上移，保持老档案的版面不变
  if (!records.length && layout.isFirstPage()) y = Math.max(y, 1380);
  block("健康助手记录", sessions, limits.sessions);
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

/** 标题按版心缩字号：宠物名最长 20 字，46px 时整行会超出页面右边 */
function fitFontSize(text: string, preferred: number, minimum: number) {
  const width = textWidth(text, preferred);
  if (width <= CONTENT_WIDTH) return preferred;
  return Math.max(minimum, Math.floor((preferred * CONTENT_WIDTH) / width));
}

function pageSvg(body: string, pageIndex: number, pageCount: number) {
  const pageNumber = pageCount > 1
    ? `<text x="${PAGE_WIDTH - CONTENT_LEFT}" y="${PAGE_HEIGHT - 60}" font-family="sans-serif" font-size="22" fill="#8b9992" text-anchor="end">第 ${pageIndex + 1} / ${pageCount} 页</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
  <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="#fdfbf7"/>
  ${body}
  <text x="${CONTENT_LEFT}" y="${PAGE_HEIGHT - 60}" font-family="sans-serif" font-size="22" fill="#8b9992">由麻麻抱我导出　内容来自你自己录入的记录　不代替医生面诊</text>
  ${pageNumber}
</svg>`;
}

/**
 * 排健康档案 / 年度健康报告的 SVG，一页一个。记录多或单条很长时续排到后续页。
 *
 * 标题措辞刻意避开「报告」二字的医学联想：叫「健康记录」与「年度健康记录」，
 * 而不是「体检报告」——「报告」在医疗语境里意味着有资质的机构给出的结论。
 */
export function buildHealthDocumentPages(input: HealthDocumentInput): string[] {
  const trend = computeWeightTrend(input.weights);
  const note = notableWeightNote(trend);
  const title = input.year ? `${input.year} 年度健康记录` : "健康记录";
  const heading = `${input.petName}的${title}`;
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
  const recordLines = input.records || [];

  const statementLines = wrapText(trend ? trend.statement : "还没有体重记录。", 26, CONTENT_WIDTH, 1);
  const noteLines = note ? wrapText(note, 24, CONTENT_WIDTH, 1) : [];

  const first = `<text x="${CONTENT_LEFT}" y="110" font-family="sans-serif" font-size="${fitFontSize(heading, 46, 30)}" font-weight="700" fill="#1d2b24">${escapeXml(heading)}</text>
  <text x="${CONTENT_LEFT}" y="152" font-family="sans-serif" font-size="26" fill="#6b7d73">${escapeXml(species)}${input.birthday ? `　${escapeXml(input.birthday)}` : ""}　${escapeXml(stage)}　导出于 ${escapeXml(input.generatedOn)}</text>

  <!--
    免责声明在第一屏顶部、与内容同屏、不折叠（红线 5）。
    底衬用浅色块而不是纯文字：这份 PDF 会被打印出来带去医院，
    没有视觉分隔的免责声明容易被当成正文的一部分读过去。
  -->
  <rect x="${CONTENT_LEFT}" y="188" width="${CONTENT_WIDTH}" height="96" rx="12" fill="#fff3e2" stroke="#e8c9a0" stroke-width="2"/>
  <text x="104" y="228" font-family="sans-serif" font-size="25" font-weight="700" fill="#8a5a20">这份记录不是诊断结论</text>
  <text x="104" y="264" font-family="sans-serif" font-size="23" fill="#8a5a20">${escapeXml(TRIAGE_DISCLAIMER)}</text>

  <text x="${CONTENT_LEFT}" y="352" font-family="sans-serif" font-size="30" font-weight="700" fill="#1d2b24">体重</text>
  <text x="${CONTENT_LEFT}" y="394" font-family="sans-serif" font-size="26" fill="#2c3a33">${escapeXml(statementLines[0] || "")}</text>
  ${noteLines.length ? `<text x="${CONTENT_LEFT}" y="430" font-family="sans-serif" font-size="24" fill="#8a5a20">${escapeXml(noteLines[0])}</text>` : ""}
  ${weightChart(input.weights, CONTENT_LEFT, 470, PAGE_WIDTH - 200, 260)}`;

  /*
   * 续页同样带一行免责提示：打印出来的第二页可能单独被翻到，
   * 没有这句话它读起来就像一页医疗意见（红线 5）。
   */
  const continuationHeading = `${heading}（续）`;
  const continuation = `<text x="${CONTENT_LEFT}" y="110" font-family="sans-serif" font-size="${fitFontSize(continuationHeading, 34, 26)}" font-weight="700" fill="#1d2b24">${escapeXml(continuationHeading)}</text>
  <text x="${CONTENT_LEFT}" y="154" font-family="sans-serif" font-size="23" fill="#8a5a20">这份记录不是诊断结论，具体情况以执业兽医面诊为准。</text>`;

  const pages: string[][] = [[first]];
  lowerSections(careLines, recordLines, sessionLines, {
    push: (part) => pages[pages.length - 1].push(part),
    newPage: () => { pages.push([continuation]); return CONTINUATION_TOP; },
    isFirstPage: () => pages.length === 1,
  });
  return pages.map((parts, index) => pageSvg(parts.join("\n  "), index, pages.length));
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
export async function renderHealthDocumentPdf(pages: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const svg of pages) {
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    const image = await pdf.embedPng(png);
    // A4 的 PDF 点尺寸（595.28×841.89），与实体印刷页同口径
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return new Uint8Array(await pdf.save());
}
