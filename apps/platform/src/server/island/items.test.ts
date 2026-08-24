import { describe, expect, it } from "vitest";

import { FEED_INTIMACY, PET_INTIMACY, findIslandItem, isFeedable, listIslandItems, pickDrop } from "@/server/island/items";

/*
 * 静态物品表（22 号文 5.4 / 4.2）。
 *
 * 这一组守的是两件事：**掉落是免费的随机**（4.1 #3：免费的随机是惊喜，
 * 付费的随机是抽奖，后者另有概率公示义务且会把整体推过类目线），
 * 以及**表结构里没有任何可购买的痕迹**（1.2 / 4.1 #2）。
 *
 * 文案类断言在 `diary-adversarial.test.ts` 的「门禁 11–14：物品表」那一节。
 */

describe("物品表结构", () => {
  it("三样东西，id 唯一", () => {
    const items = listIslandItems();
    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
  });

  /*
   * **不可购买**（1.2 / 4.1 #2）：装扮与道具只能靠积累获得。
   * 连字段都不留 —— 留了会诱导后续实现直接用上，而那时「卖装饰要先做虚拟支付改造」
   * 的判断已经没人记得（8.3 的「不预留」同一理由）。
   */
  it("没有任何价格或货币字段", () => {
    for (const item of listIslandItems()) {
      for (const field of ["price", "currency", "cost", "coins", "gems", "purchasable", "shopPrice"]) {
        expect(item, `物品 ${item.id} 出现了 ${field} —— 卖虚拟物品要先做虚拟支付改造（23 号文）`).not.toHaveProperty(field);
      }
    }
  });

  /** 素材键是 `item-set.png` 里横排三个道具的下标，端上按 1/3 切开 */
  it("素材下标是 0/1/2，与三道具一张图对应", () => {
    expect(listIslandItems().map((item) => item.spriteIndex).sort()).toEqual([0, 1, 2]);
  });

  it("按 id 查得到，未知 id 返回 undefined", () => {
    expect(findIslandItem("biscuit")?.name).toBe("饼干");
    expect(findIslandItem("nope")).toBeUndefined();
  });

  /** 返回副本，调用方改不动这张表 —— 静态表是版本化产品内容，不该被运行时改 */
  it("返回的是副本", () => {
    const first = listIslandItems();
    first[0].name = "被改了";
    expect(listIslandItems()[0].name).toBe("饼干");
    const item = findIslandItem("biscuit")!;
    item.dropWeight = 999;
    expect(findIslandItem("biscuit")!.dropWeight).not.toBe(999);
  });
});

describe("可喂判定", () => {
  it("饼干与小鱼干能喂，毛线球不能", () => {
    expect(isFeedable("biscuit")).toBe(true);
    expect(isFeedable("dried-fish")).toBe(true);
    expect(isFeedable("yarn-ball")).toBe(false);
    expect(isFeedable("nope")).toBe(false);
  });

  /*
   * **三种投喂给同一个亲密度值。** 差异化会立刻变成「喂什么最划算」，
   * 那是养成数值优化，不是陪伴。
   */
  it("能喂的东西给同一个亲密度增量", () => {
    const values = listIslandItems().filter((item) => item.feedIntimacy).map((item) => item.feedIntimacy);
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBe(FEED_INTIMACY);
  });

  /** 摸摸比喂食低 —— 喂食要先采集，多一步就该多一点 */
  it("摸摸的增量低于喂食", () => {
    expect(PET_INTIMACY).toBeLessThan(FEED_INTIMACY);
    expect(PET_INTIMACY).toBeGreaterThan(0);
  });
});

describe("掉落", () => {
  /*
   * `pickDrop` 吃注入的随机数而不是自己调 `Math.random()`：
   * 「权重高的更容易掉」这件事要能断言，而不是跑一万次看分布。
   */
  it("按权重分区：饼干 5 / 小鱼干 3 / 毛线球 2，总 10", () => {
    // 前 50% 落饼干
    expect(pickDrop(0).id).toBe("biscuit");
    expect(pickDrop(0.49).id).toBe("biscuit");
    // 50%–80% 落小鱼干
    expect(pickDrop(0.5).id).toBe("dried-fish");
    expect(pickDrop(0.79).id).toBe("dried-fish");
    // 80%–100% 落毛线球
    expect(pickDrop(0.8).id).toBe("yarn-ball");
    expect(pickDrop(0.99).id).toBe("yarn-ball");
  });

  /** 越界与非法输入不该落到数组外 */
  it("越界输入被夹住", () => {
    expect(pickDrop(1).id).toBe("yarn-ball");
    expect(pickDrop(2).id).toBe("yarn-ball");
    expect(pickDrop(-1).id).toBe("biscuit");
    expect(pickDrop(Number.NaN).id).toBe("biscuit");
  });

  /*
   * 能喂的东西必须占多数：掉一堆用不上的毛线球会让库存看起来像堆垃圾，
   * 而喂食是三个动作里最有反馈的那个。
   */
  it("可喂物的权重合计超过一半", () => {
    const items = listIslandItems();
    const total = items.reduce((sum, item) => sum + item.dropWeight, 0);
    const feedable = items.filter((item) => item.feedIntimacy).reduce((sum, item) => sum + item.dropWeight, 0);
    expect(feedable / total).toBeGreaterThan(0.5);
  });

  /** 全区间都能落到某一样，不存在空洞 */
  it("[0,1) 上处处有掉落", () => {
    for (let unit = 0; unit < 1; unit += 0.01) {
      expect(pickDrop(unit).id, `unit=${unit} 没有掉落`).toBeTruthy();
    }
  });
});
