/*
 * 用户可见文案的禁用词门禁（22 号文 9.2 门禁 11–14）。
 *
 * 词表在 `copy-guard.json`，**只有那一份**。三处读它：本文件（服务端）、
 * `domain/weight-trend.test.ts` 的红线守卫、`apps/miniprogram/scripts/validate.js`
 * （按相对路径读同一个 JSON）。方案原文点名要求「复用 `domain/weight-trend.ts`
 * 已有的评价词清单，**不新造一份**（两份必然漂移）」—— 而漂移的表现是
 * 「一边拦住了、另一边放过去了」，且没人会发现哪边是对的。
 *
 * 为什么是 JSON 而不是 `.ts`：小程序的 `validate.js` 是 CommonJS 的 node 脚本，
 * require 不了 TypeScript。反过来把词表放进 `.js` 则要在 platform 侧引一个
 * 目录外的文件（`apps/platform` 是独立的 tsconfig 根）。JSON 两边都读得动，
 * 是唯一不需要构建步骤的交集。
 *
 * 放 `domain/` 而不是 `server/`：与 `weight-trend.ts`、`island-weather.ts` 同一理由 ——
 * 端上也要用同一份判据，且它不碰数据库。
 *
 * **这一层是后置过滤，不是提示词约定。** 与健康线 `mentionsDrug` 同一性质：
 * 设计文档里的「不要写评价词」挡不住实现时的顺手一笔，而岛的日记是每天必现的内容。
 */

import guard from "@/domain/copy-guard.json";

/** 门禁类别。与 22 号文 9.2 的编号一一对应 */
export type CopyGuardCategory = "judgement" | "clinical" | "feeding" | "gamified";

export interface CopyViolation {
  category: CopyGuardCategory;
  /** 命中的词或正则源码 */
  term: string;
  /** 命中的原文片段，便于定位 —— 只给词本身的话，长文案里找不到是哪一处 */
  excerpt: string;
}

interface GuardSection {
  words?: string[];
  patterns?: string[];
}

const SECTIONS: Record<CopyGuardCategory, GuardSection> = {
  judgement: guard.judgement,
  clinical: guard.clinical,
  feeding: guard.feeding,
  gamified: guard.gamified,
};

/** 门禁 11 的评价词清单，与 `weight-trend.test.ts` 共用同一份 */
export const JUDGEMENT_WORDS: readonly string[] = guard.judgement.words;
/** 门禁 12：诊疗措辞 */
export const CLINICAL_WORDS: readonly string[] = guard.clinical.words;
/** 门禁 13：喂养建议 */
export const FEEDING_WORDS: readonly string[] = guard.feeding.words;
/** 门禁 14：游戏化词汇 */
export const GAMIFIED_WORDS: readonly string[] = guard.gamified.words;

/** 全部类别，供门禁遍历。顺序即报告顺序 */
export const COPY_GUARD_CATEGORIES: readonly CopyGuardCategory[] = ["judgement", "clinical", "feeding", "gamified"];

/** 取一个片段，让报错能定位到原文的哪一处 */
function excerptAt(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 8);
  const to = Math.min(text.length, index + length + 8);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/**
 * 扫一段用户可见文案，返回全部违例。
 *
 * **返回全部而不是首个**：门禁的价值在于一次说清所有问题 ——
 * 逐个修再逐个跑，一份日记模板要跑四遍。
 *
 * @param categories 要检查的类别。缺省全查。传子集是给「这段文案本来就在谈体重变化」
 *        这类场景留的口子，但岛的文案一律全查（岛上不出现任何健康判断，1.4）。
 */
export function findCopyViolations(text: string, categories: readonly CopyGuardCategory[] = COPY_GUARD_CATEGORIES): CopyViolation[] {
  const source = String(text || "");
  if (!source) return [];
  const violations: CopyViolation[] = [];
  for (const category of categories) {
    const section = SECTIONS[category];
    for (const word of section.words || []) {
      const index = source.indexOf(word);
      if (index >= 0) violations.push({ category, term: word, excerpt: excerptAt(source, index, word.length) });
    }
    for (const pattern of section.patterns || []) {
      // 每次新建 RegExp：带 g 的共享实例会因 lastIndex 残留而在第二次调用时漏匹配
      const match = new RegExp(pattern).exec(source);
      if (match) violations.push({ category, term: pattern, excerpt: excerptAt(source, match.index, match[0].length) });
    }
  }
  return violations;
}

/** 是否干净。等价于 `findCopyViolations(...).length === 0`，但读起来是判据而不是列表 */
export function isCopySafe(text: string, categories?: readonly CopyGuardCategory[]): boolean {
  return findCopyViolations(text, categories).length === 0;
}

/**
 * 断言一段文案干净，不干净则抛错。
 *
 * 供**服务端出口**用（日记落库前、快照下发前）。为什么运行时也要拦，而不是只靠测试：
 * 门禁 15 穷举的是模板 × 变量，而变量里有用户填的宠物名 —— 用户可以把猫命名为
 * 「等级」或「体况」，那不会出现在任何测试样本里。测试守模板，这个函数守数据。
 *
 * @param label 出错信息里的定位标签（模板 id、字段名）
 */
export function assertCopySafe(text: string, label: string, categories?: readonly CopyGuardCategory[]): void {
  const violations = findCopyViolations(text, categories);
  if (!violations.length) return;
  const first = violations[0];
  throw new Error(`文案门禁 ${first.category} 拦下 ${label}：「${first.term}」出现在「${first.excerpt}」`);
}
