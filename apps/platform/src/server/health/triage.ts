/*
 * 健康分诊的纯函数层：紧急关键词直通、四档归一、药物名过滤。
 *
 * **定位是分诊不是诊断**（16 号文第三章）。《动物诊疗机构管理办法》第十八条
 * 要求线上诊疗必须由持《动物诊疗许可证》机构的备案执业兽医师开展，
 * 而第六条要求固定实体场所 —— 纯线上拿不到许可证。所以本模块的输出
 * 只能是「紧急度分级 + 就医准备」，不能是疾病结论。
 *
 * 竞品普遍踩线（汪喵灵灵官网写「诊断准确率 90%」还给具体药物类别建议且
 * 通篇无免责声明；宠智灵宣称 >98% 识别准确率、无资质公示）。
 * 它们的合规缺口是我们的差异化，不是我们可以照做的许可。
 *
 * 放 server/ 而不是 domain/：只有服务端需要它，且药物词典不该进客户端包
 * （给了绕过过滤的线索）。
 */

/** 四档紧急度。每一档都必须给出向上升级的条件，最低档也不是终点。 */
export type TriageLevel = "emergency" | "urgent_24h" | "observe" | "routine";

/** 判定来源。审计要求：必须能事后区分规则直通与模型判定。 */
export type TriageSource = "keyword" | "model";

export interface TriageAdvisory {
  level: TriageLevel;
  /** 一句话结论。不含疾病名作为断言、不含药物。 */
  summary: string;
  /** 可能相关的方向（「可能与 A、B 相关」），不是诊断结论。 */
  relatedAreas: string[];
  /** 观察指标 / 升级条件。**每一档都必须非空。** */
  watchFor: string[];
  /** 就医准备清单：该带什么、该跟兽医说什么。 */
  visitPreparation: string[];
  /** 免责声明。由服务端下发，端上不写死 —— 两端各写一份必然漏改一处。 */
  disclaimer: string;
}

/**
 * 免责声明。**每次输出必带，且必须在结论之前或同屏呈现，不折叠。**
 *
 * 措辞刻意避开「诊断」「问诊」：不只是文案偏好，是分诊定位的一部分 ——
 * 类目描述、页面、推送里出现这些词就等于自称在做诊疗活动。
 */
export const TRIAGE_DISCLAIMER =
  "以下是基于你描述的分诊建议，不是诊断。宠物的健康状况需要执业兽医面诊判断。";

/*
 * 紧急症状关键词。命中即直通 emergency，**不调模型**。
 *
 * 理由（不只是性能）：模型有延迟也有失败率，而这类场景不能容错 ——
 * 等 AI 返回的十几秒，对尿闭的猫是实际风险。
 *
 * **宽进严出**：宁可把不紧急的判成紧急，不能反过来。所以模式要覆盖口语
 * 表达（「喘得厉害」「尿不出来」），不能只匹配医学术语 —— 用户在慌的时候
 * 不会写「呼吸窘迫」。
 */
const EMERGENCY_PATTERNS: Array<{ pattern: RegExp; area: string }> = [
  { pattern: /呼吸(困难|急促|窘迫)|喘(得厉害|不上|气)|张口呼吸|舌头?(发)?紫/, area: "呼吸" },
  { pattern: /抽搐|痉挛|癫痫|抽风|口吐白沫/, area: "神经" },
  { pattern: /误(食|吞|服)|吃了(药|老鼠药|巧克力|洋葱|百合|葡萄)|中毒/, area: "中毒" },
  { pattern: /尿(闭|不出|不下来)|排不出尿|一直蹲(厕所|猫砂)/, area: "泌尿" },
  { pattern: /大(出血|量出血)|血流不止|失血/, area: "出血" },
  { pattern: /难产|生不下来|羊水/, area: "产科" },
  { pattern: /中暑|热射|体温[过很太]高/, area: "体温" },
  { pattern: /体温[过很太]低|身体(冰|发)凉|失温/, area: "体温" },
  { pattern: /(一直|持续|不停)(呕吐|吐)|吐(得|到)(厉害|脱水)|喝不进水/, area: "消化" },
  { pattern: /肚子(鼓|胀|膨)|腹部(膨大|鼓起)|胃扭转/, area: "腹部" },
  { pattern: /瘫|站不起来|后腿拖|不能动/, area: "运动" },
  { pattern: /昏(迷|倒)|叫不醒|失去意识/, area: "意识" },
];

/**
 * 紧急关键词判定。命中返回相关部位，未命中返回 undefined。
 */
export function matchEmergency(description: string): string[] | undefined {
  const areas = EMERGENCY_PATTERNS.filter((item) => item.pattern.test(description)).map((item) => item.area);
  return areas.length ? [...new Set(areas)] : undefined;
}

/**
 * 紧急直通的固定输出。不经过模型，所以内容是确定的。
 */
export function emergencyAdvisory(areas: string[]): TriageAdvisory {
  return {
    level: "emergency",
    summary: "你描述的表现需要立即就医，请现在就联系最近的动物医院。",
    relatedAreas: areas,
    watchFor: ["路上保持通风与安静，不要喂食喂水", "如果是误食，把包装或剩余物一起带去"],
    visitPreparation: [
      "带上宠物的疫苗与驱虫记录",
      "记下症状开始的时间与变化过程",
      "如有呕吐物或排泄物异常，拍照或取样带去",
    ],
    disclaimer: TRIAGE_DISCLAIMER,
  };
}

/*
 * 药物名词典。
 *
 * **这是代码级硬约束，不能只靠提示词。** 提示词约束不可靠 —— 模型会在
 * 「不要提药」的指令下仍然提到药名。而用药建议是执业兽医的专属职权，
 * 且宠物用药的剂量与禁忌高度依赖体重与品种（猫对乙酰氨基酚致死、
 * 布洛芬对犬猫均有肾毒性），AI 给出的用药建议一旦致害，责任无处可推。
 *
 * 命中即**整段丢弃并降级为通用建议**，宁可给一个更笼统的答复。
 */
const DRUG_PATTERNS: RegExp[] = [
  // 具体通用名
  /乙酰氨基酚|扑热息痛|布洛芬|阿司匹林|阿莫西林|头孢|甲硝唑|恩诺沙星|多西环素|泼尼松|地塞米松|胰岛素|奥美拉唑|西咪替丁|马波沙星|吡虫啉|米尔贝|塞拉菌素|非泼罗尼|大环内酯/,
  // 药物类别
  /非甾体(类)?抗炎药|抗组胺(药|剂)|抗生素|消炎药|止吐药|驱虫药|抗真菌药|激素(药|类)|镇痛药|退烧药|益生菌制剂/,
  // 用法用量表达
  /(每|一)(日|天|次)\s*\d+\s*(粒|片|毫克|mg|ml|毫升|单位)/,
  /(口服|注射|喂(食|服))\s*\d/,
  /剂量|用量|按体重.*(毫克|mg)/,
  // 处置动作
  /(可以|建议|需要|应该)?(给|喂)(它|他|她)?(吃|服|用)药/,
  /自行(用|喂)药/,
];

/** 文本是否提到药物。用于输出后置过滤。 */
export function mentionsDrug(text: string): boolean {
  return DRUG_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 降级后的通用建议。药物过滤命中时用它替换模型输出。
 *
 * 保留原始档位 —— 过滤掉的是「怎么处置」，不是「有多急」。
 * 把紧急度一起降掉会造成实际风险。
 */
export function fallbackAdvisory(level: TriageLevel): TriageAdvisory {
  return {
    level,
    summary: level === "routine"
      ? "这类表现通常无需担心，若持续或加重请就医。"
      : "建议由执业兽医面诊后再决定处置方式。",
    relatedAreas: [],
    watchFor: ["症状持续超过 24 小时", "精神、食欲或饮水量明显下降", "出现新的症状"],
    visitPreparation: ["带上疫苗与驱虫记录", "记下症状开始的时间与变化过程"],
    disclaimer: TRIAGE_DISCLAIMER,
  };
}

const LEVELS: readonly TriageLevel[] = ["emergency", "urgent_24h", "observe", "routine"];

/** 归一模型返回的档位字符串。无法识别时取 `observe`（偏保守，不给「无需担心」）。 */
export function normalizeLevel(value: unknown): TriageLevel {
  const text = String(value || "").trim().toLowerCase();
  const matched = LEVELS.find((level) => level === text);
  if (matched) return matched;
  // 兼容模型可能给的中文或近似说法
  if (/立即|急诊|emergency/.test(text)) return "emergency";
  if (/24|尽快|urgent/.test(text)) return "urgent_24h";
  if (/无需|不用|routine|normal/.test(text)) return "routine";
  return "observe";
}

/**
 * 校验并修正一份分诊结论，使其满足全部合规红线。
 *
 * 这一层是**最后一道闸**：无论上游（模型或本地实现）给了什么，
 * 出这个函数的结果必须满足：
 *
 * 1. 不含药物提示（命中即整体降级）；
 * 2. `watchFor` 非空 —— 每一档都要给出向上升级的条件，
 *    最低档也不能是终点，这是红线 4；
 * 3. `summary` 不给「不用去医院」的确定结论；
 * 4. 免责声明存在。
 */
export function sanitizeAdvisory(advisory: TriageAdvisory): TriageAdvisory {
  const joined = [advisory.summary, ...advisory.relatedAreas, ...advisory.watchFor, ...advisory.visitPreparation].join(" ");
  if (mentionsDrug(joined)) return fallbackAdvisory(advisory.level);

  const watchFor = advisory.watchFor.length
    ? advisory.watchFor
    : fallbackAdvisory(advisory.level).watchFor;

  /*
   * 「不用去医院」是最危险的输出方向 —— 误判的代价不可逆。
   * 最低档的正确表述是「暂可观察，出现 X 请立即就医」，
   * 而不是「无需就医」的肯定句。
   */
  const summary = /不(用|需要?)(去)?(医院|看医生|就医)/.test(advisory.summary)
    ? fallbackAdvisory(advisory.level).summary
    : advisory.summary;

  return {
    ...advisory,
    summary,
    watchFor,
    disclaimer: TRIAGE_DISCLAIMER,
  };
}
