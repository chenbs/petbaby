import { describe, expect, it } from "vitest";

import {
  CLINICAL_WORDS,
  COPY_GUARD_CATEGORIES,
  FEEDING_WORDS,
  GAMIFIED_WORDS,
  JUDGEMENT_WORDS,
  assertCopySafe,
  findCopyViolations,
  isCopySafe,
} from "@/domain/copy-guard";
import {
  ISLAND_DIARY_TEMPLATES,
  enumerateDiaryEntries,
  findDiaryViolations,
  renderDiary,
  renderDiarySkeleton,
  selectDiaryEntry,
} from "@/server/island/diary";
import { listIslandItems } from "@/server/island/items";
import { GATHER_DAILY_LIMIT } from "@/server/island-service";

/*
 * 宠物小岛的文案门禁 11–15（22 号文 9.2），仿 `triage-adversarial.test.ts` 立法。
 *
 * 那一组的立法思路是「不测正常情况能过，测各种绕法能不能穿过过滤」，因为
 * **模型确实会在明令禁止的情况下写出违规内容**。岛这边的对手不是模型（日记是模板拼装，
 * 4.2 已定），而是**将来动这些模板的人**：设计约定挡不住实现时的顺手一笔，
 * 而日记是每天必现的内容 —— 一个评价词会推给每一个用户，每天一次。
 *
 * 五项分工：
 *   11 健康评价词（生病/太胖/正常范围/BMI…）—— 复用 weight-trend 的清单，不新造一份
 *   12 诊疗措辞（诊断/确诊/治愈/问诊）
 *   13 喂养建议（克数、毫升、每日建议、真实品牌）
 *   14 游戏化词汇（等级/经验/体力/金币/关卡/排行榜/抽卡）
 *   15 日记模板全量穷举 × 11–14
 *
 * **模板拼装的好处正在于可穷举**（4.2），所以第 15 项不是抽样而是遍历全部分支。
 */

describe("门禁 11–14：词表本身", () => {
  /*
   * 清单**只有一份**（22 号文 9.2 #11 明确要求「复用已有的评价词清单，不新造一份 ——
   * 两份必然漂移」）。这一条钉住 `copy-guard.json` 与 `weight-trend.test.ts` 读的是同一处：
   * 那边现在也 import 这几个常量，任何一方另开一份都会在这里露出来。
   */
  it("评价词清单含体况评分类词汇，且没有第二份", () => {
    for (const word of ["偏胖", "偏瘦", "超重", "肥胖", "营养不良", "BMI", "体况", "正常", "健康", "异常"]) {
      expect(JUDGEMENT_WORDS, `评价词清单缺「${word}」`).toContain(word);
    }
  });

  it("诊疗措辞清单是红线的那四个词", () => {
    expect([...CLINICAL_WORDS].sort()).toEqual(["治愈", "确诊", "诊断", "问诊"].sort());
  });

  it("喂养与游戏化清单覆盖关键词", () => {
    for (const word of ["每日建议", "营养成分", "配方"]) expect(FEEDING_WORDS).toContain(word);
    // 「体力」是这一类里最要紧的：措辞差异决定采集是不是 4.1 #4 的体力值
    for (const word of ["体力", "等级", "经验", "金币", "关卡", "排行榜", "抽卡"]) expect(GAMIFIED_WORDS).toContain(word);
  });

  it("四个类别都在遍历清单里 —— 少一个等于那条门禁没跑", () => {
    expect([...COPY_GUARD_CATEGORIES].sort()).toEqual(["clinical", "feeding", "gamified", "judgement"]);
  });
});

describe("门禁 11：健康评价词的对抗性输入", () => {
  /*
   * 每一条都是一次真实可能被写出来的岛内文案。**岛上宠物不表现任何健康状态**
   * （4.1 #9）：用户会把岛上宠物的状态读作对自家宠物的判断，而体况评分是执业兽医的
   * 触诊项目，靠岛上的表现和体重数字都算不出来。
   */
  const attempts = [
    "它今天精神不太好，好像生病了",
    "摩奇最近有点偏胖，少喂一点吧",
    "体重在正常范围内",
    "看起来很健康",
    "它有点营养不良",
    "BMI 偏高，该减肥了",
    "体况评分 4 分，稍微超重",
    "今天状态异常，注意观察",
    "达标了，是标准体型",
    "理想体重范围内",
  ];

  it.each(attempts)("拦下：%s", (text) => {
    const violations = findCopyViolations(text);
    expect(violations.length, `「${text}」穿过了评价词门禁`).toBeGreaterThan(0);
    expect(violations.some((item) => item.category === "judgement" || item.category === "feeding")).toBe(true);
  });

  /*
   * 误杀检查。过度拦截会让人把门禁关掉，那比漏拦更糟 ——
   * 这些是岛上真会出现的正常文案。
   */
  it.each([
    "今天的草丛都看过了，明天再来转转",
    "它把头顶过来，眼睛眯成一条线",
    "天刚亮，小岛上没什么风。它自己待了一会儿。",
    "外面在下雨，它待在屋檐底下",
    "和摩奇一起走到了第 100 天",
    "草丛里翻出一个小鱼干",
    "落了雪，屋檐下还是干的",
  ])("不误杀：%s", (text) => {
    expect(isCopySafe(text), `「${text}」被误判为违例：${JSON.stringify(findCopyViolations(text))}`).toBe(true);
  });
});

describe("门禁 12：诊疗措辞", () => {
  it.each([
    "这不是诊断，只是记录",
    "已确诊为皮肤问题",
    "过几天就治愈了",
    "要不要线上问诊一下",
  ])("拦下：%s", (text) => {
    expect(findCopyViolations(text, ["clinical"]).length, `「${text}」穿过了诊疗措辞门禁`).toBeGreaterThan(0);
  });

  /*
   * **连否定句也要拦。** 健康线的免责声明里「不是诊断」是合法的（那是法规要求的
   * 声明本身），但**岛内不该出现这个词的任何用法** —— 岛是互动层，一提到诊断
   * 就是在把它往诊疗活动上靠（红线 1 的口径是「用户可见文案不得出现」）。
   * 所以这里不做否定句豁免，与 health/document.test.ts 的处理刻意不同。
   */
  it("否定句同样拦下 —— 岛内不出现这个词的任何用法", () => {
    expect(isCopySafe("这不是诊断")).toBe(false);
  });
});

describe("门禁 13：喂养建议", () => {
  /*
   * **给出克数或频次即构成喂养建议**（4.1 #10），而剂量依赖体重与品种，
   * 与药物剂量同类。饼干就是饼干，不写「每日建议摄入」。
   */
  it.each([
    "每天喂 20 克就够",
    "建议摄入 150 千卡",
    "倒 50 毫升水",
    "这款主食罐的粗蛋白很高",
    "换成皇家的配方吧",
    "每日建议两次",
    "喂 30g 冻干",
  ])("拦下：%s", (text) => {
    expect(findCopyViolations(text).length, `「${text}」穿过了喂养建议门禁`).toBeGreaterThan(0);
  });

  /*
   * 计量正则不能把技术串误判。误杀会让人把门禁关掉。
   * `(?![a-z])` 那个否定环视就是为这个加的 —— 「1080p」「640px」不是喂养建议。
   */
  it.each(["草丛里翻出一个饼干", "画面 1080p", "缩到 640px", "第 100 天"])("不误杀：%s", (text) => {
    expect(isCopySafe(text), `「${text}」被误判：${JSON.stringify(findCopyViolations(text))}`).toBe(true);
  });
});

describe("门禁 14：游戏化词汇", () => {
  /*
   * 这条同时是**类目风险的自检**（22 号文 1.1）：普通小程序的类目表里没有「游戏」，
   * 游戏是独立账号类型 + 版号。关卡、排行榜、体力值、抽卡任一项都会把整体推过线。
   *
   * 「体力」这一条最要紧：到上限后说「今天的草丛都看过了」是互动营销层，
   * 说「体力耗尽」就是游戏机制 —— **措辞差异本身就是那条边界**。
   */
  it.each([
    "体力耗尽了，明天再来",
    "行动点用完了",
    "亲密度等级提升到 3 级",
    "获得 20 点经验",
    "金币 +5",
    "解锁下一个关卡",
    "本周排行榜第 12 名",
    "来抽一张卡",
    "开箱得到毛线球",
    "战斗胜利",
    "完成任务奖励",
    "连续签到奖励",
  ])("拦下：%s", (text) => {
    expect(findCopyViolations(text, ["gamified"]).length, `「${text}」穿过了游戏化词汇门禁`).toBeGreaterThan(0);
  });

  /** 到上限时的正确措辞必须过 —— 它是这条门禁存在的目的的正面 */
  it("「今天的草丛都看过了」是安全的措辞", () => {
    for (const text of ["今天的草丛都看过了，明天再来转转", "它今天吃得挺好，明天再喂吧", "今天已经摸够多啦"]) {
      expect(isCopySafe(text), `${text} 被误判`).toBe(true);
    }
  });
});

describe("门禁 15：日记模板全量穷举", () => {
  /*
   * **模板拼装的好处正在于可穷举**（4.2），这一条是那条判据的兑现。
   * 不抽样 —— 抽样漏掉的那一格正是会出问题的那一格。
   */
  it("覆盖全部模板与全部变量组合", () => {
    const entries = enumerateDiaryEntries();
    // 环境句 4 昼夜 × 4 天气 × 4 活动档（采集档取 1 与上限两个端点）= 68
    expect(entries.length).toBeGreaterThanOrEqual(68);
    const templates = new Set(entries.map((entry) => entry.templateId));
    for (const templateId of ISLAND_DIARY_TEMPLATES) {
      expect(templates, `模板 ${templateId} 没有进穷举，等于它没被门禁扫过`).toContain(templateId);
    }
  });

  it("全部组合的产物不含任何词表命中", () => {
    const violations = findDiaryViolations();
    expect(
      violations,
      violations.length ? `日记模板违例：${violations.map((item) => `${item.templateId}「${item.term}」→ ${item.text}`).join("；")}` : "",
    ).toEqual([]);
  });

  /** 逐条也验一遍非空：模板拼出空串会静默通过词表检查 */
  it("每个组合都产出非空文案", () => {
    for (const entry of enumerateDiaryEntries()) {
      const text = renderDiarySkeleton(entry);
      expect(text.length, `${entry.templateId} 拼出了空文案`).toBeGreaterThan(4);
    }
  });

  /*
   * 采集件数的两个端点都要在文案里正确出现。8 是每日上限 ——
   * 若哪天上限调了而穷举没跟着调，这条会提醒。
   */
  it("采集件数取到每日上限时文案仍正确", () => {
    const text = renderDiary({ templateId: "ambient-v1", payload: { phase: "day", weather: "clear", activity: "gathered", gathered: GATHER_DAILY_LIMIT } });
    expect(text).toContain(`${GATHER_DAILY_LIMIT} 样东西`);
    expect(isCopySafe(text)).toBe(true);
  });
});

describe("门禁 11–14：物品表", () => {
  /*
   * 物品名与描述也在门禁范围内（9.2 #11 的「物品名」、#13 的「物品与文案」）。
   * **不出现真实品牌、不写成分与克数**（4.1 #10）—— 饼干就是饼干。
   */
  it("全部物品名与描述都干净", () => {
    for (const item of listIslandItems()) {
      const text = `${item.name} ${item.note}`;
      expect(isCopySafe(text), `物品 ${item.id} 的文案违例：${JSON.stringify(findCopyViolations(text))}`).toBe(true);
    }
  });

  /** 描述**只说这个东西是什么样，不说它对宠物有什么好处** —— 后者是喂养建议也接近健康判断 */
  it("描述不含功效话术", () => {
    for (const item of listIslandItems()) {
      for (const word of ["补充", "有益", "增强", "促进", "改善", "预防", "缓解"]) {
        expect(item.note, `物品 ${item.id} 的描述含功效词「${word}」`).not.toContain(word);
      }
    }
  });
});

describe("宠物名不参与门禁扫描", () => {
  /*
   * **门禁扫的是我们写的文案，不是用户的数据。**
   *
   * 用户可以把猫命名为「正常」或「体况」。拿真名去扫模板产物，结果是给这些用户
   * 直接封掉日记功能 —— 既解决不了合规问题（名字是用户自己填的），又损失了功能。
   * 所以 `renderDiarySkeleton` 把名字换成占位词，门禁 15 扫它。
   */
  it("骨架把宠物名换成占位词，真名不影响门禁结论", () => {
    const entry = { templateId: "milestone-v1" as const, payload: { petName: "体况", milestoneDay: 100 } };
    expect(renderDiary(entry)).toContain("体况");
    expect(renderDiarySkeleton(entry)).not.toContain("体况");
    expect(isCopySafe(renderDiarySkeleton(entry))).toBe(true);
  });

  /*
   * 但**运行时出口仍会拦**（`assertCopySafe` 在 `submitIslandAction` 与
   * `writeDiaryEntry` 里）。分工是：测试守模板，运行时守数据 ——
   * 一只叫「体况」的猫会让每条文案都命中，报错比静默下发违规文案好。
   */
  it("运行时断言对含真名的成品仍然生效", () => {
    expect(() => assertCopySafe(renderDiary({ templateId: "milestone-v1", payload: { petName: "体况", milestoneDay: 100 } }), "test")).toThrow(/体况/);
  });
});

describe("日记模板选择的优先级（4.2）", () => {
  const base = { petName: "摩奇", days: 50, phase: "day" as const, weather: "clear" as const };

  /** ① 今天有新上传照片 → 引用那张的场景 */
  it("有新照片时优先引用照片", () => {
    const entry = selectDiaryEntry({ ...base, photoCount: 3 });
    expect(entry.templateId).toBe("photo-today-v1");
    expect(renderDiary(entry)).toContain("3 张");
  });

  /** ② 命中「去年今日」→ 引用去年 */
  it("没有新照片但命中去年今日时引用去年", () => {
    const entry = selectDiaryEntry({ ...base, onThisDay: { date: "2025-08-05", yearsAgo: 1, day: 320 } });
    expect(entry.templateId).toBe("on-this-day-v1");
    const text = renderDiary(entry);
    expect(text).toContain("去年的今天");
    expect(text).toContain("2025-08-05");
    expect(text).toContain("第 320 天");
  });

  /** 2 年以上说「N 年前的今天」而不是「去年今日」 */
  it("两年以上改说 N 年前的今天", () => {
    const entry = selectDiaryEntry({ ...base, onThisDay: { date: "2023-08-05", yearsAgo: 3, day: 90 } });
    expect(renderDiary(entry)).toContain("3 年前的今天");
  });

  /** ③ 里程碑日 → 引用天数。**不含第 1 天**（那是起点不是成就） */
  it("里程碑日引用天数，第 1 天不算里程碑", () => {
    expect(selectDiaryEntry({ ...base, days: 100 }).templateId).toBe("milestone-v1");
    expect(selectDiaryEntry({ ...base, days: 365 }).templateId).toBe("milestone-v1");
    expect(selectDiaryEntry({ ...base, days: 1000 }).templateId).toBe("milestone-v1");
    expect(selectDiaryEntry({ ...base, days: 1 }).templateId).toBe("ambient-v1");
  });

  /** 一周年的措辞是「一起过了一年」而不是「第 365 天」，与 `milestoneLabel` 同源 */
  it("一周年用专门的措辞", () => {
    expect(renderDiary(selectDiaryEntry({ ...base, days: 365 }))).toContain("一起过了一年");
  });

  /** ④ 兜底 → 按昼夜与采集行为拼一句 */
  it("兜底按昼夜与行为拼句，优先级 fed > gathered > petted > idle", () => {
    expect(selectDiaryEntry({ ...base, fed: 1, gathered: 3, petted: 2 }).payload.activity).toBe("fed");
    expect(selectDiaryEntry({ ...base, gathered: 3, petted: 2 }).payload.activity).toBe("gathered");
    expect(selectDiaryEntry({ ...base, petted: 2 }).payload.activity).toBe("petted");
    expect(selectDiaryEntry(base).payload.activity).toBe("idle");
  });

  /*
   * **岛不制造负面情绪**（4.1 #6，「N 天不来它会难过」是明确的禁止项）。
   * `idle` 那句会在离线补齐时用到 —— 用户没来过的那天也走这一档。
   */
  it("没人来的那天不说「没人陪它」这类话", () => {
    const text = renderDiary(selectDiaryEntry(base));
    for (const word of ["难过", "孤单", "没人", "等你", "想你", "寂寞", "不开心", "失望"]) {
      expect(text, `兜底文案不该有「${word}」：${text}`).not.toContain(word);
    }
    expect(text).toContain("它自己待了一会儿");
  });

  /** 雨雪档说的是**躲雨**而不是淋雨（2.5.2），与端上的 shelter 站位切换对齐 */
  it("雨雪档的文案说躲雨，与端上站位切换说同一件事", () => {
    expect(renderDiary(selectDiaryEntry({ ...base, weather: "rain" }))).toContain("屋檐");
    expect(renderDiary(selectDiaryEntry({ ...base, weather: "snow" }))).toContain("屋檐");
  });

  /** 未知模板回落到环境句而不是抛错 —— 库里可能存着已下线的模板 id */
  it("未知模板 id 仍渲染得出，不抛错", () => {
    const text = renderDiary({ templateId: "who-knows-v9", payload: { phase: "night", weather: "clear" } });
    expect(text).toContain("夜里");
  });
});
