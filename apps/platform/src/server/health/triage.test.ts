import { describe, expect, it } from "vitest";

import {
  TRIAGE_DISCLAIMER,
  emergencyAdvisory,
  fallbackAdvisory,
  matchEmergency,
  mentionsDrug,
  normalizeLevel,
  sanitizeAdvisory,
  type TriageAdvisory,
} from "@/server/health/triage";

/*
 * 健康分诊的合规红线测试（16 号文 3.8）。
 *
 * 这一组不是普通的功能测试：每条对应一条法律或安全约束，
 * 挂掉意味着产品可能给出致害建议或触碰诊疗资质边界。
 */

describe("紧急症状关键词直通", () => {
  /*
   * **宽进严出**：宁可把不紧急的判成紧急，不能反过来。
   * 用户在慌的时候不会写「呼吸窘迫」，所以口语表达必须命中。
   */
  it.each([
    ["猫突然呼吸困难，张着嘴喘", "呼吸"],
    ["狗喘得厉害，舌头有点紫", "呼吸"],
    ["刚才抽搐了一下，口吐白沫", "神经"],
    ["它误食了老鼠药", "中毒"],
    ["猫一直蹲猫砂但尿不出来", "泌尿"],
    ["伤口血流不止", "出血"],
    ["生不下来，已经两个小时了", "产科"],
    ["中暑了，体温很高", "体温"],
    ["身体冰凉，好像失温", "体温"],
    ["一直呕吐，喝不进水", "消化"],
    ["肚子鼓起来很硬", "腹部"],
    ["后腿拖着走，站不起来", "运动"],
    ["叫不醒，好像昏迷了", "意识"],
  ])("命中：%s", (description, area) => {
    const areas = matchEmergency(description);
    expect(areas, `「${description}」应命中紧急直通`).toBeDefined();
    expect(areas).toContain(area);
  });

  it("普通症状不命中直通", () => {
    expect(matchEmergency("最近有点掉毛，会挠痒")).toBeUndefined();
    expect(matchEmergency("眼角有一点眼屎")).toBeUndefined();
  });

  it("紧急输出带升级条件与就医准备，且不含药物", () => {
    const advisory = emergencyAdvisory(["呼吸"]);
    expect(advisory.level).toBe("emergency");
    expect(advisory.watchFor.length).toBeGreaterThan(0);
    expect(advisory.visitPreparation.length).toBeGreaterThan(0);
    expect(advisory.disclaimer).toBe(TRIAGE_DISCLAIMER);
    expect(mentionsDrug([advisory.summary, ...advisory.watchFor, ...advisory.visitPreparation].join(" "))).toBe(false);
  });
});

describe("药物名过滤（红线 2，代码级硬约束）", () => {
  /*
   * 提示词约束不可靠 —— 模型会在「不要提药」的指令下仍然提到药名。
   * 用药建议是执业兽医的专属职权，且宠物用药的剂量与禁忌高度依赖
   * 体重与品种（猫对乙酰氨基酚致死、布洛芬对犬猫均有肾毒性）。
   */
  it.each([
    "可以给它吃点布洛芬缓解",
    "建议服用阿莫西林",
    "用非甾体抗炎药控制炎症",
    "可以喂抗组胺药",
    "每天 2 片，饭后服用",
    "按体重给 5 毫克",
    "建议使用抗生素治疗",
    "先给它吃药观察",
    "注射胰岛素控制血糖",
    "涂抹抗真菌药膏",
  ])("识别药物提示：%s", (text) => {
    expect(mentionsDrug(text), `「${text}」应被识别为药物提示`).toBe(true);
  });

  it("正常分诊文案不误判", () => {
    expect(mentionsDrug("建议 24 小时内就医，由执业兽医面诊确认")).toBe(false);
    expect(mentionsDrug("带上疫苗与驱虫记录")).toBe(false);
    expect(mentionsDrug("症状持续超过 24 小时请立即就医")).toBe(false);
  });

  it("命中药物时整体降级为通用建议，但保留原档位", () => {
    const tainted: TriageAdvisory = {
      level: "urgent_24h",
      summary: "可能是肠胃炎，可以先喂点甲硝唑",
      relatedAreas: ["消化"],
      watchFor: ["持续呕吐"],
      visitPreparation: ["带上病历"],
      disclaimer: TRIAGE_DISCLAIMER,
    };
    const clean = sanitizeAdvisory(tainted);
    // 过滤掉的是「怎么处置」，不是「有多急」—— 把紧急度一起降掉会造成实际风险。
    expect(clean.level).toBe("urgent_24h");
    expect(mentionsDrug(clean.summary)).toBe(false);
    expect(clean.watchFor.length).toBeGreaterThan(0);
  });
});

describe("四档归一", () => {
  it("识别标准值", () => {
    expect(normalizeLevel("emergency")).toBe("emergency");
    expect(normalizeLevel("urgent_24h")).toBe("urgent_24h");
    expect(normalizeLevel("observe")).toBe("observe");
    expect(normalizeLevel("routine")).toBe("routine");
  });

  it("兼容模型的中文或近似说法", () => {
    expect(normalizeLevel("立即就医")).toBe("emergency");
    expect(normalizeLevel("24小时内")).toBe("urgent_24h");
    expect(normalizeLevel("通常无需担心")).toBe("routine");
  });

  /** 无法识别时取 observe 而不是 routine：偏保守，不轻易给「无需担心」。 */
  it("无法识别时保守取 observe", () => {
    expect(normalizeLevel("")).toBe("observe");
    expect(normalizeLevel(undefined)).toBe("observe");
    expect(normalizeLevel("看起来还行")).toBe("observe");
  });
});

describe("最后一道闸：sanitizeAdvisory", () => {
  /*
   * 红线 4：最低档也不能是终点。「不用去医院」是最危险的输出方向 ——
   * 误判的代价不可逆。
   */
  it("拒绝「不用去医院」这类确定结论", () => {
    const clean = sanitizeAdvisory({
      level: "routine",
      summary: "这种情况不用去医院",
      relatedAreas: [],
      watchFor: ["持续三天"],
      visitPreparation: [],
      disclaimer: TRIAGE_DISCLAIMER,
    });
    expect(clean.summary).not.toMatch(/不用去医院/);
    expect(clean.summary).toMatch(/就医/);
  });

  it("watchFor 为空时补上升级条件", () => {
    const clean = sanitizeAdvisory({
      level: "routine",
      summary: "这类表现通常无需担心，若持续或加重请就医。",
      relatedAreas: [],
      watchFor: [],
      visitPreparation: [],
      disclaimer: TRIAGE_DISCLAIMER,
    });
    expect(clean.watchFor.length).toBeGreaterThan(0);
  });

  it("免责声明始终由服务端统一下发", () => {
    const clean = sanitizeAdvisory({
      level: "observe",
      summary: "暂可观察",
      relatedAreas: [],
      watchFor: ["加重"],
      visitPreparation: [],
      disclaimer: "被端上改过的文案",
    });
    expect(clean.disclaimer).toBe(TRIAGE_DISCLAIMER);
  });

  /** 免责措辞不得出现「诊断」「问诊」—— 那等于自称在做诊疗活动。 */
  it("免责声明本身不含违规措辞", () => {
    expect(TRIAGE_DISCLAIMER).toMatch(/不是诊断/);
    expect(TRIAGE_DISCLAIMER).toMatch(/执业兽医/);
    expect(TRIAGE_DISCLAIMER).not.toMatch(/问诊|确诊|治愈/);
  });

  it("fallbackAdvisory 各档都给出升级条件", () => {
    for (const level of ["emergency", "urgent_24h", "observe", "routine"] as const) {
      const advisory = fallbackAdvisory(level);
      expect(advisory.watchFor.length, `${level} 缺升级条件`).toBeGreaterThan(0);
      expect(advisory.disclaimer).toBe(TRIAGE_DISCLAIMER);
    }
  });
});
