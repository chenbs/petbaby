import { describe, expect, it } from "vitest";

import {
  TRIAGE_DISCLAIMER,
  emergencyAdvisory,
  fallbackAdvisory,
  matchEmergency,
  mentionsDisease,
  sanitizeAdvisory,
  stripDiseaseMentions,
  type TriageAdvisory,
} from "@/server/health/triage";

/*
 * 病名过滤（2026-10）。接入 qwen-flash 后实测，模型在提示词禁止的情况下仍写出
 * 「提示可能存在消化系统问题，如胃炎、异物梗阻或肠胃感染」。说出病名就是在下诊断（红线 1）。
 */

const base = (patch: Partial<TriageAdvisory>): TriageAdvisory => ({
  level: "urgent_24h",
  summary: "",
  relatedAreas: ["消化"],
  watchFor: ["呕吐次数增加"],
  visitPreparation: ["拍下呕吐物"],
  disclaimer: TRIAGE_DISCLAIMER,
  ...patch,
});

describe("病名过滤", () => {
  it.each([
    "可能是胃炎",
    "考虑肠胃炎",
    "提示可能存在异物梗阻",
    "疑似猫瘟",
    "可能有细菌感染",
    "像是耳螨",
    "可能是膀胱结石",
    "怀疑是猫传腹",
    "需要排查糖尿病",
    "可能是肾衰",
    "有可能是过敏",
    "这是典型的皮肤炎症",
    "确诊需要拍片",
  ])("识别病名：%s", (text) => {
    expect(mentionsDisease(text), `「${text}」应被识别为病名`).toBe(true);
  });

  /* 误杀检查：现象描述、部位与安全提示不能被当成病名，否则大部分回答都会被删空 */
  it.each([
    "今天吐了两次，精神还行",
    "便便偏软，次数比平时多",
    "一直挠耳朵，耳朵里有黑色分泌物",
    "可能与消化系统有关",
    "涉及耳部和皮肤",
    "拍下呕吐物照片",
    "记下最近 3 次进食与排便的时间",
    "如果是误食，把包装一起带去",
    "可能误食中毒，请立即联系医生",
    "精神、食欲或饮水量明显下降",
    "掉毛比平时多",
    "建议今天带它去看看，请医生当面确认。",
  ])("不误杀：%s", (text) => {
    expect(mentionsDisease(text), `「${text}」被误判为病名`).toBe(false);
  });

  it("删掉含病名的分句，连同只起引出作用的半句", () => {
    const real = "猫咪30月龄，近7天内出现多次呕吐（今日已吐2次），虽精神尚可，但反复呕吐提示可能存在消化系统问题，如胃炎、异物梗阻或肠胃感染，需尽快就医排查病因。";
    const cleaned = stripDiseaseMentions(real);
    expect(mentionsDisease(cleaned)).toBe(false);
    expect(cleaned).toContain("近7天内出现多次呕吐");
    expect(cleaned).toContain("需尽快就医排查病因");
    expect(cleaned).not.toContain("如");
  });

  it("删完只剩残句时返回空串，由调用方换通用句", () => {
    expect(stripDiseaseMentions("可能是胃炎。")).toBe("");
    expect(stripDiseaseMentions("虽然精神尚可，但疑似胃肠炎。")).toBe("");
  });

  it("sanitizeAdvisory：summary 删病名、列表删条目、紧急度不变", () => {
    const clean = sanitizeAdvisory(base({
      summary: "今天吐了两次没消化的粮，精神还行，可能是胃炎，建议今天带它去看看。",
      relatedAreas: ["消化", "胰腺炎"],
      watchFor: ["呕吐次数增加", "出现猫瘟典型表现"],
      visitPreparation: ["拍下呕吐物", "排查是否寄生虫感染"],
    }));
    expect(clean.level).toBe("urgent_24h");
    expect(clean.summary).toBe("今天吐了两次没消化的粮，精神还行，建议今天带它去看看。");
    expect(clean.relatedAreas).toEqual(["消化"]);
    expect(clean.watchFor).toEqual(["呕吐次数增加"]);
    expect(clean.visitPreparation).toEqual(["拍下呕吐物"]);
  });

  it("列表被删空时换成通用内容，升级条件不能为空", () => {
    const clean = sanitizeAdvisory(base({ summary: "疑似胰腺炎", watchFor: ["胰腺炎加重"], visitPreparation: ["确诊需要验血"] }));
    const fallback = fallbackAdvisory("urgent_24h");
    expect(clean.summary).toBe(fallback.summary);
    expect(clean.watchFor).toEqual(fallback.watchFor);
    expect(clean.visitPreparation).toEqual(fallback.visitPreparation);
    expect(clean.level).toBe("urgent_24h");
  });

  /* 紧急直通的固定输出本身不能被病名过滤动到，尤其是「误食中毒」这类安全提示 */
  it("紧急模板与降级模板都不含病名", () => {
    const emergency = emergencyAdvisory(matchEmergency("误食了巧克力") || []);
    const texts = [emergency, ...(["emergency", "urgent_24h", "observe", "routine"] as const).map(fallbackAdvisory)]
      .flatMap((advisory) => [advisory.summary, ...advisory.watchFor, ...advisory.visitPreparation]);
    for (const text of texts) expect(mentionsDisease(text), text).toBe(false);
    expect(sanitizeAdvisory(emergency)).toEqual(emergency);
  });
});
