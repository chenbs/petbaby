/*
 * 日常记录的类型清单（2026-10）。**表单结构与展示文案的单一事实源**：
 * 小程序按 `/api/daily-log-kinds` 下发的字段渲染表单，服务端按同一份清单校验并生成
 * 列表 / 就医摘要 / 健康档案里的文字。两端各写一份选项文案，改一处必然漏一处。
 *
 * 文案红线（与健康线同口径，见 CLAUDE.md「健康分诊线」）：
 * - 只描述看到的现象，不出现病名、不给评价（没有「正常」「异常」「严重」这类档位）；
 *   便便形态用「成形 / 偏软 / 水样」这类可观察的描述，而不是「正常 / 腹泻」。
 * - 用药名、用量由用户按兽医医嘱自己填，**产品不给候选清单**（红线 2）。
 */

export type DailyLogKind = "meal" | "water" | "stool" | "vomit" | "symptom" | "medication" | "visit" | "grooming" | "other";
/** 快记宫格里的全部类型。weight / care 写入各自的老表（0018 / 0022），只在清单里登记表单。 */
export type RecordKind = DailyLogKind | "weight" | "care";

export interface ChoiceOption { value: string; label: string }

export type FieldSpec =
  | { key: string; label: string; type: "choice"; options: ChoiceOption[]; required?: boolean; multiple?: boolean }
  | { key: string; label: string; type: "count"; min: number; max: number; defaultValue: number; unit: string }
  | { key: string; label: string; type: "text"; maxLength: number; placeholder: string; required?: boolean }
  | { key: string; label: string; type: "toggle" }
  | { key: string; label: string; type: "date"; placeholder: string }
  | { key: string; label: string; type: "number"; placeholder: string; unit: string; required?: boolean };

export interface KindSpec {
  kind: RecordKind;
  label: string;
  /** 小程序图标名（assets/icons/<theme>/rk-<icon>.png） */
  icon: string;
  /** 列表筛选分组 */
  group: "body" | "food" | "medical" | "care" | "weight" | "life";
  /** 身体状况类：保存后提示「可以让健康助手看看」，并作为分诊上下文 */
  bodily: boolean;
  /** 是否允许附图（呕吐物、便便、处方单这类给兽医看的照片） */
  attachments: boolean;
  fields: FieldSpec[];
  notePlaceholder: string;
}

export const RECORD_KINDS: KindSpec[] = [
  {
    kind: "meal", label: "吃饭", icon: "meal", group: "food", bodily: false, attachments: false, notePlaceholder: "比如换了新粮、加了罐头",
    fields: [
      { key: "appetite", label: "吃了多少", type: "choice", required: true, options: [
        { value: "none", label: "没吃" }, { value: "little", label: "吃了一点" }, { value: "half", label: "一半左右" },
        { value: "most", label: "大部分" }, { value: "all", label: "吃完了" },
      ] },
      { key: "food", label: "吃的什么", type: "text", maxLength: 30, placeholder: "可不填" },
    ],
  },
  {
    kind: "water", label: "喝水", icon: "water", group: "food", bodily: false, attachments: false, notePlaceholder: "可不填",
    fields: [
      { key: "amount", label: "和平时比", type: "choice", required: true, options: [
        { value: "less", label: "比平时少" }, { value: "usual", label: "差不多" }, { value: "more", label: "比平时多" },
      ] },
    ],
  },
  {
    kind: "stool", label: "便便", icon: "stool", group: "body", bodily: true, attachments: true, notePlaceholder: "比如气味很重、在猫砂盆外",
    fields: [
      { key: "form", label: "形态", type: "choice", required: true, options: [
        { value: "hard", label: "干硬" }, { value: "formed", label: "成形" }, { value: "soft", label: "偏软" },
        { value: "mushy", label: "糊状" }, { value: "watery", label: "水样" },
      ] },
      { key: "color", label: "颜色", type: "choice", options: [
        { value: "brown", label: "棕色" }, { value: "yellow", label: "黄色" }, { value: "black", label: "黑色" },
        { value: "red", label: "发红" }, { value: "green", label: "绿色" }, { value: "pale", label: "灰白" },
      ] },
      { key: "count", label: "次数", type: "count", min: 1, max: 10, defaultValue: 1, unit: "次" },
      { key: "blood", label: "看到血丝", type: "toggle" },
      { key: "mucus", label: "有黏液", type: "toggle" },
    ],
  },
  {
    kind: "vomit", label: "呕吐", icon: "vomit", group: "body", bodily: true, attachments: true, notePlaceholder: "比如吃完就吐、吐前一直舔嘴",
    fields: [
      { key: "count", label: "次数", type: "count", min: 1, max: 20, defaultValue: 1, unit: "次" },
      { key: "content", label: "吐出来的", type: "choice", options: [
        { value: "food", label: "没消化的粮" }, { value: "foam", label: "白色泡沫" }, { value: "yellow", label: "黄色液体" },
        { value: "hairball", label: "毛球" }, { value: "clear", label: "清水" }, { value: "other", label: "其他" },
      ] },
      { key: "blood", label: "看到血", type: "toggle" },
    ],
  },
  {
    kind: "symptom", label: "不舒服", icon: "symptom", group: "body", bodily: true, attachments: true, notePlaceholder: "什么时候开始的、有没有变化",
    fields: [
      // 不设必填：说不清是哪一种时，只写备注也能存
      { key: "signs", label: "看到了什么", type: "choice", multiple: true, options: [
        { value: "lethargic", label: "精神差" }, { value: "appetite", label: "不太吃东西" }, { value: "cough", label: "咳嗽" },
        { value: "sneeze", label: "打喷嚏" }, { value: "nose", label: "流鼻涕" }, { value: "eye", label: "眼睛分泌物多" },
        { value: "scratch", label: "一直挠" }, { value: "hair", label: "掉毛多" }, { value: "limp", label: "走路一瘸一拐" },
        { value: "thirst", label: "喝水变多" }, { value: "urine", label: "尿得频繁" }, { value: "shiver", label: "发抖" },
        { value: "hide", label: "躲起来" }, { value: "other", label: "其他" },
      ] },
    ],
  },
  {
    kind: "medication", label: "用药", icon: "medication", group: "medical", bodily: false, attachments: true, notePlaceholder: "比如饭后喂、还剩几天",
    fields: [
      { key: "name", label: "药名", type: "text", maxLength: 40, placeholder: "按医嘱填写", required: true },
      { key: "dose", label: "用量", type: "text", maxLength: 30, placeholder: "按医嘱填写，如「半片」" },
      // 疗程天数 > 1 时，记录页顶部会出现「用药第 N 天 / 共 M 天」，之后每次喂药点一下即可
      { key: "courseDays", label: "疗程", type: "count", min: 1, max: 60, defaultValue: 1, unit: "天" },
    ],
  },
  {
    kind: "visit", label: "看诊检查", icon: "visit", group: "medical", bodily: false, attachments: true, notePlaceholder: "花费、检查项目，或者想记住的事",
    fields: [
      { key: "type", label: "这次是", type: "choice", required: true, options: [
        { value: "visit", label: "看病" }, { value: "recheck", label: "复查" }, { value: "checkup", label: "体检" }, { value: "test", label: "做检查" },
      ] },
      { key: "hospital", label: "在哪里看的", type: "text", maxLength: 40, placeholder: "可不填" },
      { key: "reason", label: "为什么去", type: "text", maxLength: 60, placeholder: "比如连续两天呕吐" },
      { key: "vetSaid", label: "医生怎么说", type: "text", maxLength: 120, placeholder: "把医生的原话记下来，下次复诊用得上" },
      { key: "followUpOn", label: "复诊日期", type: "date", placeholder: "不复诊可不填" },
    ],
  },
  {
    kind: "weight", label: "体重", icon: "weight", group: "weight", bodily: false, attachments: false, notePlaceholder: "可不填",
    fields: [{ key: "weightKg", label: "体重", type: "number", placeholder: "例如 4.2", unit: "公斤", required: true }],
  },
  {
    kind: "care", label: "疫苗驱虫", icon: "care", group: "care", bodily: false, attachments: false, notePlaceholder: "可不填",
    fields: [
      { key: "careKind", label: "类型", type: "choice", required: true, options: [
        { value: "vaccine", label: "疫苗" }, { value: "deworm_internal", label: "体内驱虫" },
        { value: "deworm_external", label: "体外驱虫" }, { value: "checkup", label: "体检" },
      ] },
      { key: "label", label: "项目", type: "text", maxLength: 40, placeholder: "例如「猫三联」，按实际填写", required: true },
      { key: "dueOn", label: "下次到期", type: "date", placeholder: "到期前一周提醒你" },
    ],
  },
  {
    kind: "grooming", label: "洗护", icon: "grooming", group: "life", bodily: false, attachments: false, notePlaceholder: "比如这次没怎么挣扎",
    fields: [
      { key: "items", label: "做了什么", type: "choice", multiple: true, required: true, options: [
        { value: "bath", label: "洗澡" }, { value: "nail", label: "剪指甲" }, { value: "ear", label: "清耳朵" },
        { value: "teeth", label: "刷牙" }, { value: "brush", label: "梳毛" }, { value: "haircut", label: "美容" },
      ] },
    ],
  },
  {
    kind: "other", label: "小事", icon: "other", group: "life", bodily: false, attachments: true, notePlaceholder: "第一次学会握手、今天特别黏人……",
    fields: [],
  },
];

export const KIND_SPEC: Record<string, KindSpec> = Object.fromEntries(RECORD_KINDS.map((spec) => [spec.kind, spec]));
export const DAILY_LOG_KINDS = RECORD_KINDS.map((spec) => spec.kind).filter((kind) => kind !== "weight" && kind !== "care") as DailyLogKind[];

export const CARE_KIND_TEXT: Record<string, string> = {
  vaccine: "疫苗",
  deworm_internal: "体内驱虫",
  deworm_external: "体外驱虫",
  checkup: "体检",
};

function optionLabel(spec: KindSpec, key: string, value: unknown): string {
  const field = spec.fields.find((item) => item.key === key);
  if (!field || field.type !== "choice") return "";
  return field.options.find((option) => option.value === value)?.label || "";
}

export function formatGrams(grams: number) {
  return grams >= 1000 ? `${Number((grams / 1000).toFixed(2))} 公斤` : `${grams} 克`;
}

/**
 * 一条记录的展示文字：`title` 是类型名，`summary` 是用「·」连起来的事实。
 * 列表、就医摘要、分诊上下文、健康档案 PDF 共用这一个函数。
 */
export function describeRecord(kind: string, details: Record<string, unknown>): { title: string; summary: string } {
  if (kind === "weight") return { title: "体重", summary: formatGrams(Number(details.weightGrams || 0)) };
  if (CARE_KIND_TEXT[kind]) {
    const parts = [String(details.label || "")];
    if (details.dueOn) parts.push(`下次 ${String(details.dueOn)}`);
    return { title: CARE_KIND_TEXT[kind], summary: parts.filter(Boolean).join(" · ") };
  }
  const spec = KIND_SPEC[kind];
  if (!spec) return { title: "记录", summary: "" };
  const parts: string[] = [];
  for (const field of spec.fields) {
    const value = details[field.key];
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (field.type === "choice") {
      const labels = (Array.isArray(value) ? value : [value]).map((item) => optionLabel(spec, field.key, item)).filter(Boolean);
      if (labels.length) parts.push(labels.join("、"));
    } else if (field.type === "count") {
      // 1 次是默认值，不写进摘要，免得每条都挂一个「1 次」
      if (Number(value) > 1) parts.push(field.key === "courseDays" ? `疗程 ${Number(value)} 天` : `${Number(value)} ${field.unit}`);
    } else if (field.type === "toggle") parts.push(field.label);
    else if (field.type === "date") parts.push(`${field.label} ${String(value)}`);
    else if (field.key === "vetSaid") parts.push(`医生说：${String(value)}`);
    else parts.push(String(value));
  }
  return { title: spec.label, summary: parts.join(" · ") };
}
