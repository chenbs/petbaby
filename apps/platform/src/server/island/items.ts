/*
 * 宠物小岛的静态物品表（22 号文 5.4 / 4.2）。
 *
 * **进代码不进库**，与 `plugins/registry.ts` 同一模式：物品定义是版本化的产品内容，
 * 不是用户数据。库里只有 `island_inventory` 的 `(island_id, item_id, count)` ——
 * 名字、素材键、掉落权重全在这里，改一个名字不需要写迁移。
 *
 * 三条红线在这张表上有具体禁止项：
 *
 * 1. **不可购买**（1.2 / 4.1 #2）。所以没有 `price`、没有 `currency`、没有
 *    `purchasable` —— 连字段都不留。留了会诱导后续实现直接用上，而那时
 *    「卖装饰要先做虚拟支付改造」的判断已经没人记得（8.3 的「不预留」同一理由）。
 * 2. **不涉及品牌、成分、克数、喂养建议**（4.1 #10）。饼干就是饼干，
 *    不写「每日建议摄入」也不写「粗蛋白 32%」—— 给出克数或频次即构成喂养建议，
 *    而那依赖体重品种，与药物剂量同类。`items.test.ts` 扫全表钉住这条。
 * 3. **不表现任何健康状态**（4.1 #9）。描述里不出现「补充营养」「有益健康」
 *    这类功效话术 —— 用户会把它读作对自家宠物的喂养指导。
 *
 * 命名保持抽象且具体：「小鱼干」是一个东西，「营养棒」是一个功效承诺。
 */

/** 物品用途。`treat` 能喂，`toy` 只能收着看（M2 才有摆放） */
export type IslandItemKind = "treat" | "toy";

export interface IslandItem {
  id: string;
  /** 显示名。抽象、无品牌、无成分 */
  name: string;
  /**
   * 一句话描述。**只描述这个东西是什么样，不说它对宠物有什么好处** ——
   * 后者是喂养建议（红线 2）也接近健康判断（红线 1）。
   */
  note: string;
  kind: IslandItemKind;
  /**
   * 素材键。对应 `item-set.png` 里横排三个道具的第几个（端上按 1/3 切开）。
   * 三个一张图是刻意的：同一次生成出来的东西不会跑风格（24 号文 2.3）。
   */
  spriteIndex: number;
  /**
   * 采集掉落权重。相对值，不是概率 —— 加物品时不必重算其他项。
   *
   * 毛线球权重最低：它不能喂，掉多了会让库存看起来堆着一堆用不上的东西。
   */
  dropWeight: number;
  /**
   * 喂食时增加的亲密度。
   *
   * **亲密度只增不减**（4.2），且不显示为进度条（4.1 #5 禁等级/经验条），
   * 只在里程碑时给一句话。三种投喂给同一个值 —— 差异化会立刻变成「喂什么最划算」，
   * 那是养成数值优化，不是陪伴。
   */
  feedIntimacy?: number;
}

/** 单次喂食的亲密度增量。三种投喂物统一取值，见 `feedIntimacy` 的说明 */
export const FEED_INTIMACY = 2;

/** 摸一次的亲密度增量。比喂食低 —— 喂食要先采集，多一步就该多一点 */
export const PET_INTIMACY = 1;

const ITEMS: IslandItem[] = [
  {
    id: "biscuit",
    name: "饼干",
    note: "小小的爪印形状，烤得有点焦边。",
    kind: "treat",
    spriteIndex: 0,
    dropWeight: 5,
    feedIntimacy: FEED_INTIMACY,
  },
  {
    id: "dried-fish",
    name: "小鱼干",
    note: "银白的一条，尾巴翘着。",
    kind: "treat",
    spriteIndex: 1,
    dropWeight: 3,
    feedIntimacy: FEED_INTIMACY,
  },
  {
    id: "yarn-ball",
    name: "毛线球",
    note: "珊瑚粉的一团，线头散出来一小截。",
    kind: "toy",
    spriteIndex: 2,
    dropWeight: 2,
  },
];

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));

/** 全部物品。返回副本，调用方改不动这张表 */
export function listIslandItems(): IslandItem[] {
  return ITEMS.map((item) => ({ ...item }));
}

export function findIslandItem(id: string): IslandItem | undefined {
  const item = BY_ID.get(String(id));
  return item ? { ...item } : undefined;
}

/** 可喂的物品 id 集合。喂食入参校验用 */
export function isFeedable(id: string): boolean {
  return Boolean(BY_ID.get(String(id))?.feedIntimacy);
}

/**
 * 按权重挑一个掉落物。
 *
 * **随机但全程免费**（4.1 #3 / 4.2）：免费的随机是惊喜，付费的随机是抽奖 ——
 * 后者另有概率公示义务且会把整体推过类目线。所以这里没有「保底」「十连」
 * 这类概念，也不接受外部传入的权重加成。
 *
 * @param unit [0,1) 的随机数。由调用方注入 —— 服务端用 `Math.random()`，
 *        测试注入固定值。不在这里调 `Math.random()` 是为了让掉落可测：
 *        「权重高的更容易掉」这件事要能断言，而不是跑一万次看分布。
 */
export function pickDrop(unit: number): IslandItem {
  const total = ITEMS.reduce((sum, item) => sum + item.dropWeight, 0);
  // 夹在 [0,1) 内：传进来 1 或负数时不该落到数组外
  const safe = Number.isFinite(unit) ? Math.min(0.999999, Math.max(0, unit)) : 0;
  let cursor = safe * total;
  for (const item of ITEMS) {
    cursor -= item.dropWeight;
    if (cursor < 0) return { ...item };
  }
  // 浮点兜底。走到这里说明累加有误差，给权重最高的那个
  return { ...ITEMS[0] };
}
