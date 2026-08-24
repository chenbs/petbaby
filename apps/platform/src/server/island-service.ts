import "server-only";

import { z } from "zod";

import { anchorOf, daysSince, MILESTONE_DAYS } from "@/domain/companion";
import { assertCopySafe } from "@/domain/copy-guard";
import { ambientAt, asDateKey, type IslandDayPhase, type IslandWeather } from "@/domain/island-weather";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { ISLAND_ANCHORS, islandAssetUrls } from "@/server/island/assets";
import {
  kindOfTemplate,
  renderDiary,
  selectDiaryEntry,
  type IslandDiaryEntry,
  type IslandDiaryPayload,
} from "@/server/island/diary";
import { FEED_INTIMACY, PET_INTIMACY, findIslandItem, pickDrop } from "@/server/island/items";
import { findOnThisDay } from "@/server/timeline-service";

/*
 * 宠物小岛的服务层（22 号文第 3–5 章）。
 *
 * **这是仓库里第一个留存型模块**，既有六类生成管线的假设（任务入队、产出作品、
 * 可分享、可定价）一条都不适用：岛的互动是同步请求-响应，不进 `generation_tasks`，
 * 产出是状态而不是作品，所以不写 `works`、没有 share_token、没有定价。
 *
 * 三条最容易做错的，全在 5.6：
 *
 * 1. **额度与亲密度只能由服务端计算。** 端上传「我采集了一次」，服务端校验当日额度
 *    并返回结果，端上不预测。岛的即时反馈会诱使实现方在端上先加数再同步 ——
 *    那样断网重连就会对不上，而岛的库存是要累积的，对不上不只是显示错，
 *    是用户觉得东西丢了。
 * 2. **时间取服务端。** 端上时间可改，用它算「今天」会让用户改系统时间刷额度。
 *    昼夜光照可以用端上时间（纯表现，改了只是看到不同光照，无收益）—— 这条边界不能混。
 * 3. **离线事件在下次打开时懒结算**，不需要 Worker 定时跑：岛没有「必须按时发生」的事
 *    （掉线惩罚已被 4.1 #6/#7 禁掉），懒结算够用且省掉一整轮轮询成本。
 *
 * `memorial` 宠物不进岛（1.4 / 4.1 #11）：**服务端拦 + 端上列表过滤，两处都要**。
 * 端上那一半在 `island/service.js` 的 `selectablePets()`。
 */

/** 采集每日上限。到上限后的措辞是「今天的草丛都看过了」而不是「体力耗尽」（4.2） */
export const GATHER_DAILY_LIMIT = 8;

/**
 * 喂食与摸摸的每日上限。
 *
 * 比采集宽：喂食要先采集（受采集上限间接约束），摸摸零成本 ——
 * 给上限只为挡住脚本刷亲密度，不是为了限制陪伴。措辞同样不能是体力。
 */
export const FEED_DAILY_LIMIT = 8;
export const PET_DAILY_LIMIT = 20;

/** M1 只支持一只宠物入岛（9.4 第 4 项拍板）。多只同屏会让浅俯视下的构图与命中判定陡增 */
export const MAX_ISLAND_PETS = 1;

/** 三个动作的上限表。列名与 `island_daily_actions` 的列一致 */
const ACTION_LIMITS = { gathered: GATHER_DAILY_LIMIT, fed: FEED_DAILY_LIMIT, petted: PET_DAILY_LIMIT } as const;

/** 动作类型 → 计数列 */
const ACTION_COLUMN = { gather: "gathered", feed: "fed", pet: "petted" } as const;

export type IslandActionType = keyof typeof ACTION_COLUMN;

const actionSchema = z.object({
  type: z.enum(["gather", "feed", "pet"]),
  /** 命中的热区 id（grass / bowl / pet）。只用于日志与校验，落点由端上命中表给 */
  targetId: z.string().trim().max(40).optional(),
  /** 喂食时投喂哪一样。缺省取库存里能喂的第一样 */
  itemId: z.string().trim().max(40).optional(),
});

export interface IslandInventoryEntry {
  itemId: string;
  name: string;
  note: string;
  count: number;
  spriteIndex: number;
  feedable: boolean;
}

export interface IslandSnapshot {
  id: string;
  sceneId: string;
  version: number;
  /** 入岛的宠物。M1 最多一只，所以给单数字段而不是数组 */
  pet?: {
    id: string;
    name: string;
    lifeStage: string;
    /** 起算日，供端上 `services/companion.js` 算陪伴天数 —— **端上不重算规则，只重算数字** */
    birthday?: string;
    createdAt: string;
    /** 已离开的宠物按它封口。岛本不该有这种宠物，留着是为了历史数据也不会递增 */
    memorialSince?: string;
    intimacy: number;
    /** 立绘对象键有值时给可取字节的地址；为空说明还没生成 */
    avatarUrl?: string;
    avatarRunId?: string;
  };
  inventory: IslandInventoryEntry[];
  /** 今日已用次数。列名与上限表对齐，端上按 `limit - used` 显示剩余 */
  today: { gathered: number; fed: number; petted: number };
  limits: typeof ACTION_LIMITS;
  /** 今天的日记（已渲染）。没有就是今天还没结算出条目 */
  diary?: { date: string; kind: string; templateId: string; text: string };
  /** 素材地址，已补域名 */
  assets: Partial<Record<string, string>>;
  /** 底图坐标。端上逐键合并到预设上 */
  anchors: typeof ISLAND_ANCHORS;
  /** 服务端权威日期，YYYY-MM-DD。端上不拿它算光照（那用本机时间），只用于展示与对账 */
  serverDate: string;
  /** 已达成的里程碑。只列过去的 —— 「还差 20 天」是催促（4.1 #7） */
  milestones: Array<{ day: number; reached: boolean }>;
}

/* ---------- 内部读写 ---------- */

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * 服务端「今天」。**额度按这个判定，端上传的日期一律不采信**（5.6）。
 *
 * 取本地年月日而不是 `toISOString().slice(0,10)`：`action_date` 是 `date` 列、无时区，
 * 转 UTC 会在东八区把 08:00 前的操作记到前一天（健康线 `asDateString` 同一处理）。
 */
function serverDateKey(now = new Date()): string {
  return asDateKey(now);
}

async function findIslandRow(userId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT id,user_id,scene_id,version,last_tick_at,created_at FROM islands WHERE user_id=$1",
    [userId],
  );
  return rows[0];
}

/**
 * 建岛。**幂等**（5.5）：首次进入时端上可能并发发两次，靠 `user_id` 上的唯一约束 +
 * `ON CONFLICT` 比先查后插可靠。
 */
export async function ensureIsland(userId: string) {
  const database = await getDatabase();
  const now = new Date();
  await database.query(
    "INSERT INTO islands (id,user_id,scene_id,version,last_tick_at,created_at) VALUES ($1,$2,'yard-v1',1,$3,$3) ON CONFLICT (user_id) DO NOTHING",
    [crypto.randomUUID(), userId, now],
  );
  const row = await findIslandRow(userId);
  if (!row) throw new AppError("ISLAND_CREATE_FAILED", "小岛创建失败，请重试", 500);
  return row;
}

async function requireIsland(userId: string) {
  const row = await findIslandRow(userId);
  if (!row) throw new AppError("ISLAND_NOT_FOUND", "还没有小岛", 404);
  return row;
}

/**
 * 今日额度行。**不存在就建一行**（`ON CONFLICT DO NOTHING` + 回读），
 * 与 `health_daily_quotas` 的手法一致。
 */
async function loadToday(islandId: string, dateKey: string) {
  const database = await getDatabase();
  await database.query(
    "INSERT INTO island_daily_actions (id,island_id,action_date,gathered,fed,petted) VALUES ($1,$2,$3,0,0,0) ON CONFLICT (island_id,action_date) DO NOTHING",
    [crypto.randomUUID(), islandId, dateKey],
  );
  const rows = await database.query<{ gathered: number; fed: number; petted: number }>(
    "SELECT gathered,fed,petted FROM island_daily_actions WHERE island_id=$1 AND action_date=$2",
    [islandId, dateKey],
  );
  const row = rows[0] || { gathered: 0, fed: 0, petted: 0 };
  return { gathered: Number(row.gathered) || 0, fed: Number(row.fed) || 0, petted: Number(row.petted) || 0 };
}

async function loadInventory(islandId: string): Promise<IslandInventoryEntry[]> {
  const rows = await (await getDatabase()).query<{ item_id: string; count: number }>(
    "SELECT item_id,count FROM island_inventory WHERE island_id=$1 AND count>0 ORDER BY item_id",
    [islandId],
  );
  const entries: IslandInventoryEntry[] = [];
  for (const row of rows) {
    const item = findIslandItem(String(row.item_id));
    // 物品表里已删掉的 id 不下发：静态表是版本化产品内容，下线的物品不该再出现在背包里。
    // 库里那一行保留不动 —— 删数据是不可逆的，而重新上架同一个 id 就能让它回来。
    if (!item) continue;
    entries.push({
      itemId: item.id,
      name: item.name,
      note: item.note,
      count: Number(row.count) || 0,
      spriteIndex: item.spriteIndex,
      feedable: Boolean(item.feedIntimacy),
    });
  }
  return entries;
}

/**
 * 岛上那只宠物。
 *
 * `memorial` 判定在**读取侧**也做一次：入岛时拦了，但用户可以入岛之后再把生命阶段
 * 改成「已离开」—— 那种情况不删记录（那段陪伴发生过），而是不再下发，
 * 岛回到「还没有宠物入岛」的状态。0024 的表注释已写明这条分工。
 */
async function loadIslandPet(islandId: string, petId?: string) {
  /*
   * `petId` 是**优先项而不是过滤条件**：端上从宠物档案的操作行进来时会带它
   * （CLAUDE.md：入口必须带 `petId`，不带的话点非默认宠物会看到错的那只），
   * 而从「我的」页进来没有「哪一只」的上下文，那时按 `joined_at` 取最早入岛的。
   *
   * 用 `ORDER BY (pet_id = $2) DESC` 而不是 `WHERE pet_id = $2`：M1 只住得下一只，
   * 传进来的那只很可能还没入岛 —— 硬过滤会让快照变成「岛上没有宠物」，
   * 而用户明明看得到岛上住着一只。排序优先则是「有就给你要的那只，没有就给岛上那只」。
   *
   * M1 阶段这个差别被 `MAX_ISLAND_PETS = 1` 遮住（只有一只，取谁都一样），
   * 但 M2 支持多只入岛后它会立刻变成必现缺陷，而表现是「点第二只看到第一只」，
   * 不报错。所以现在就把参数接通，不留到 M2。
   */
  const rows = await (await getDatabase()).query(
    `SELECT ip.id,ip.pet_id,ip.avatar_key,ip.avatar_run_id,ip.intimacy,ip.joined_at,
            p.name,p.birthday,p.life_stage,p.created_at pet_created_at,
            (SELECT MIN(created_at) FROM memorial_spaces WHERE pet_id=p.id AND deleted_at IS NULL) memorial_since
       FROM island_pets ip JOIN pets p ON p.id = ip.pet_id
      WHERE ip.island_id=$1 AND p.deleted_at IS NULL AND p.life_stage <> 'memorial'
      ORDER BY (ip.pet_id = $2) DESC, ip.joined_at
      LIMIT 1`,
    [islandId, petId || null],
  );
  return rows[0];
}

/* ---------- 快照 ---------- */

/**
 * 岛全量快照（`GET /api/island`）。
 *
 * 顺带做两件事：**懒结算离线日记**（5.6）与**补齐今日额度行**。放在读取路径上而不是
 * Worker 里，是因为岛没有「必须按时发生」的事 —— 用户不打开就不需要有日记，
 * 而一旦打开就要看到期间的条目。
 *
 * @param origin 用于给素材补域名。由路由传入（`PUBLIC_APP_URL` 或请求来源）
 * @param petId 端上带来的「想看哪一只」。缺省时给岛上最早入岛的那只，见 `loadIslandPet`
 */
export async function getIslandSnapshot(userId: string, origin: string, now = new Date(), petId?: string): Promise<IslandSnapshot> {
  const island = await requireIsland(userId);
  const islandId = String(island.id);
  const dateKey = serverDateKey(now);

  // 结算要在读额度之前：日记文案会引用当日采集次数，顺序反了会用上昨天的数
  await settleDiary(userId, islandId, now);

  const [today, inventory, petRow, diary] = await Promise.all([
    loadToday(islandId, dateKey),
    loadInventory(islandId),
    loadIslandPet(islandId, petId),
    loadDiaryOn(islandId, dateKey),
  ]);

  const pet = petRow
    ? {
        id: String(petRow.pet_id),
        name: String(petRow.name),
        lifeStage: String(petRow.life_stage || "active"),
        birthday: petRow.birthday ? String(petRow.birthday) : undefined,
        createdAt: iso(petRow.pet_created_at),
        ...(petRow.memorial_since ? { memorialSince: iso(petRow.memorial_since) } : {}),
        intimacy: Number(petRow.intimacy) || 0,
        /*
         * **绝对地址，与素材同一处理**（5.3）：立绘要经 `wx.downloadFile` 取字节，
         * 而以 `/` 开头的值会被当主包内本地文件找，必然裂图且不报错。
         *
         * 注意路径里不 `encodeURIComponent` 整个键 —— 它是多段路径
         * （`private/<uid>/island/...`），整体编码会把 `/` 变成 `%2F`，
         * 而 catch-all 路由按段拆分，收到的就是一段而非四段。逐段编码即可。
         */
        ...(petRow.avatar_key
          ? { avatarUrl: `${String(origin || "").replace(/\/+$/, "")}/api/island/avatar-image/${String(petRow.avatar_key).split("/").map(encodeURIComponent).join("/")}` }
          : {}),
        ...(petRow.avatar_run_id ? { avatarRunId: String(petRow.avatar_run_id) } : {}),
      }
    : undefined;

  /*
   * 里程碑只列已达成的（4.2）。天数按 `memorialSince` 封口 ——
   * 岛上本不该有已离开的宠物，但历史数据若有，天数也不能继续往上涨。
   */
  const days = pet ? daysSince(anchorOf({ birthday: pet.birthday, createdAt: pet.createdAt }), pet.memorialSince) : 0;
  const milestones = MILESTONE_DAYS.map((day) => ({ day, reached: day <= days }));

  return {
    id: islandId,
    sceneId: String(island.scene_id || "yard-v1"),
    version: Number(island.version) || 1,
    pet,
    inventory,
    today,
    limits: ACTION_LIMITS,
    diary,
    assets: islandAssetUrls(origin),
    anchors: ISLAND_ANCHORS,
    serverDate: dateKey,
    milestones,
  };
}

/* ---------- 宠物入岛 ---------- */

const joinSchema = z.object({ petId: z.string().uuid() });

/**
 * 宠物入岛。
 *
 * **`memorial` 服务端拦**（1.4 / 4.1 #11）。理由：岛的核心机制是「亲密度日增、
 * 陪伴天数往上涨」，对已离开的宠物递增天数是明确的冒犯（CLAUDE.md 已钉死
 * 「陪伴天数一律封口」）。纪念形态的对应能力是纪念空间，不是岛。
 *
 * **端上列表过滤是另一半，两处都要**：只做端上隐藏则接口仍可调，
 * 只做服务端拦截则用户会看到入口点进去报错。
 */
export async function joinIslandPet(userId: string, input: unknown) {
  const data = joinSchema.parse(input);
  const database = await getDatabase();
  const island = await ensureIsland(userId);

  const petRows = await database.query(
    "SELECT id,name,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [data.petId, userId],
  );
  const pet = petRows[0];
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  if (String(pet.life_stage) === "memorial") {
    throw new AppError("ISLAND_UNAVAILABLE_MEMORIAL", "已经离开的宠物有纪念空间陪着，不进小岛", 409);
  }

  /*
   * 两个聚合一次查完，且**必须用聚合而不是「查那一行再看有没有」**：
   * 后者在宠物不在岛上时返回零行，于是拿不到总数、上限判定恒为通过。
   * `count(*)` 与 `count(*) FILTER` 在空表上都返回一行 0，所以 `rows[0]` 总在。
   */
  const stats = await database.query<{ total: number; mine: number }>(
    "SELECT count(*)::int total, count(*) FILTER (WHERE pet_id=$2)::int mine FROM island_pets WHERE island_id=$1",
    [island.id, data.petId],
  );
  // 已经在岛上：幂等返回，不报错 —— 重复点「进岛」不该看到失败
  if (Number(stats[0]?.mine) > 0) return { joined: true, petId: data.petId };

  const total = Number(stats[0]?.total) || 0;
  if (total >= MAX_ISLAND_PETS) {
    // M1 只支持一只（9.4 第 4 项）。措辞说「小岛现在只住得下一只」而不是「超出上限」
    throw new AppError("ISLAND_PET_LIMIT", "小岛现在只住得下一只，先让它待着吧", 409);
  }

  await database.query(
    "INSERT INTO island_pets (id,island_id,pet_id,intimacy,joined_at) VALUES ($1,$2,$3,0,$4) ON CONFLICT (island_id,pet_id) DO NOTHING",
    [crypto.randomUUID(), island.id, data.petId, new Date()],
  );
  return { joined: true, petId: data.petId };
}

/**
 * 可入岛的宠物列表（`GET /api/island` 的辅助，也供引导页用）。
 *
 * **过滤掉 `memorial`** —— 这是那条红线的「端上列表过滤」在服务端的对照实现：
 * 端上自己也过滤一次（`island/service.js`），两份都在是刻意的。
 */
export async function listIslandCandidates(userId: string) {
  const rows = await (await getDatabase()).query(
    `SELECT p.id,p.name,p.species,p.life_stage,p.avatar_key,
            (SELECT count(*)::int FROM photos WHERE pet_id=p.id AND deleted_at IS NULL) photo_count
       FROM pets p
      WHERE p.user_id=$1 AND p.deleted_at IS NULL AND p.life_stage <> 'memorial'
      ORDER BY p.is_default DESC, p.created_at`,
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    species: String(row.species),
    lifeStage: String(row.life_stage || "active"),
    photoCount: Number(row.photo_count) || 0,
  }));
}

/* ---------- 互动 ---------- */

export interface IslandActionResult {
  type: IslandActionType;
  /** 掉落物。只有采集会有 */
  drop?: { itemId: string; name: string; count: number };
  /** 投喂掉的东西。只有喂食会有 */
  consumed?: { itemId: string; name: string };
  intimacy: number;
  today: { gathered: number; fed: number; petted: number };
  inventory: IslandInventoryEntry[];
  /** 一句反馈。**不是数值弹字**（4.2：喂食后的反馈是表情与动作） */
  message: string;
}

/**
 * 递增当日计数并校验上限。**一条 SQL 完成读改判**：
 * 先查再写会在并发点击下双花额度（两个请求都读到 7，各自写成 8）。
 *
 * 超限时返回 undefined 由调用方抛 429 —— 不在这里抛，是因为超限的措辞按动作类型不同
 * （「今天的草丛都看过了」/「它今天吃得挺好」），而措辞差异决定它是不是体力值。
 */
async function bumpAction(islandId: string, dateKey: string, column: "gathered" | "fed" | "petted") {
  const database = await getDatabase();
  const rows = await database.query<{ gathered: number; fed: number; petted: number }>(
    `INSERT INTO island_daily_actions (id,island_id,action_date,gathered,fed,petted)
       VALUES ($1,$2,$3,${column === "gathered" ? 1 : 0},${column === "fed" ? 1 : 0},${column === "petted" ? 1 : 0})
     ON CONFLICT (island_id,action_date) DO UPDATE SET ${column}=island_daily_actions.${column}+1
     WHERE island_daily_actions.${column} < $4
     RETURNING gathered,fed,petted`,
    [crypto.randomUUID(), islandId, dateKey, ACTION_LIMITS[column]],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { gathered: Number(row.gathered) || 0, fed: Number(row.fed) || 0, petted: Number(row.petted) || 0 };
}

/** 到达上限时的措辞。**不能说「体力耗尽」「行动点用完」**（4.1 #4 / 4.2） */
function limitMessage(type: IslandActionType): string {
  if (type === "gather") return "今天的草丛都看过了，明天再来转转";
  if (type === "feed") return "它今天吃得挺好，明天再喂吧";
  return "今天已经摸够多啦";
}

/** 亲密度累加。**只增不减**（4.2）—— 表上有 `CHECK (intimacy >= 0)`，这里也没有减的路径 */
async function addIntimacy(islandId: string, petId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  const rows = await (await getDatabase()).query<{ intimacy: number }>(
    "UPDATE island_pets SET intimacy=intimacy+$3 WHERE island_id=$1 AND pet_id=$2 RETURNING intimacy",
    [islandId, petId, amount],
  );
  return Number(rows[0]?.intimacy) || 0;
}

/**
 * 单一互动端点（`POST /api/island/actions`）。
 *
 * **三个动作不拆成三条路由**（5.5）：它们共用同一套额度校验、同一份亲密度累加、
 * 同一处文案门禁 —— 拆开等于把门禁复制三份，而门禁复制三份就一定会漏改一处
 * （健康线的「两处都要」教训正是这个）。
 */
export async function submitIslandAction(userId: string, input: unknown, now = new Date()): Promise<IslandActionResult> {
  const data = actionSchema.parse(input);
  const database = await getDatabase();
  const island = await requireIsland(userId);
  const islandId = String(island.id);
  const dateKey = serverDateKey(now);

  const petRow = await loadIslandPet(islandId);
  if (!petRow) throw new AppError("ISLAND_PET_REQUIRED", "先让一只宠物住进来", 409);
  const petId = String(petRow.pet_id);
  const petName = String(petRow.name);
  const column = ACTION_COLUMN[data.type];

  /*
   * 喂食要先确认有东西可喂，**在扣额度之前** ——
   * 顺序反了会让「背包空着点了喂食」白白吃掉一次额度。
   */
  let feedItem = data.itemId ? findIslandItem(data.itemId) : undefined;
  if (data.type === "feed") {
    if (data.itemId && !feedItem) throw new AppError("ISLAND_ITEM_UNKNOWN", "没有这样的东西", 422);
    if (feedItem && !feedItem.feedIntimacy) throw new AppError("ISLAND_ITEM_NOT_FEEDABLE", "这个不能吃", 422);
    if (!feedItem) {
      // 没指定就取库存里能喂的第一样：端上的「喂它」是一个按钮而不是选择器
      const available = (await loadInventory(islandId)).find((entry) => entry.feedable && entry.count > 0);
      if (!available) throw new AppError("ISLAND_NOTHING_TO_FEED", "先去草丛里找点吃的吧", 409);
      feedItem = findIslandItem(available.itemId);
    }
    const consumed = await database.query(
      "UPDATE island_inventory SET count=count-1 WHERE island_id=$1 AND item_id=$2 AND count>0 RETURNING count",
      [islandId, feedItem!.id],
    );
    if (!consumed[0]) throw new AppError("ISLAND_NOTHING_TO_FEED", "先去草丛里找点吃的吧", 409);
  }

  const today = await bumpAction(islandId, dateKey, column);
  if (!today) {
    /*
     * 超额。喂食已经扣掉的那件要退回来 —— 扣了库存又没喂成是净损失，
     * 而库存是用户攒的。退回走 `+1` 而不是重新插入：那一行必然存在（刚扣过）。
     */
    if (data.type === "feed" && feedItem) {
      await database.query("UPDATE island_inventory SET count=count+1 WHERE island_id=$1 AND item_id=$2", [islandId, feedItem.id]);
    }
    throw new AppError("ISLAND_ACTION_LIMIT", limitMessage(data.type), 429);
  }

  let drop: IslandActionResult["drop"];
  let message = "";
  let gain = 0;

  if (data.type === "gather") {
    /*
     * **随机但全程免费**（4.1 #3）：免费的随机是惊喜，付费的随机是抽奖。
     * `Math.random()` 在这里是对的 —— 掉落不需要可复现（与天气不同，天气要
     * 端上服务端算出同一个结果，掉落只由服务端决定并下发）。
     */
    const item = pickDrop(Math.random());
    const rows = await database.query<{ count: number }>(
      "INSERT INTO island_inventory (id,island_id,item_id,count) VALUES ($1,$2,$3,1) ON CONFLICT (island_id,item_id) DO UPDATE SET count=island_inventory.count+1 RETURNING count",
      [crypto.randomUUID(), islandId, item.id],
    );
    drop = { itemId: item.id, name: item.name, count: Number(rows[0]?.count) || 1 };
    message = `草丛里翻出一个${item.name}`;
  } else if (data.type === "feed") {
    gain = feedItem!.feedIntimacy || FEED_INTIMACY;
    message = `${petName}把${feedItem!.name}吃完了，蹭了蹭你的手`;
  } else {
    gain = PET_INTIMACY;
    message = `${petName}把头顶过来，眼睛眯成一条线`;
  }

  const intimacy = gain ? await addIntimacy(islandId, petId, gain) : Number(petRow.intimacy) || 0;

  /*
   * 出口门禁（门禁 11–14）。**运行时也要拦，不只靠测试**：
   * 测试穷举的是模板与词表，而这里的文案里有用户填的宠物名 —— 用户可以把猫命名为
   * 「体况」。所以扫的是拼好的成品，命中即拒绝下发而不是静默改写。
   *
   * 名字本身命中时报错是可接受的：那说明这个名字会让每条文案都违例，
   * 而改名的代价远小于关掉整个模块。
   */
  assertCopySafe(message, `island action ${data.type}`);

  // `last_tick_at` 推进：离线结算的边界。互动本身就是一次「打开过」的证据
  await database.query("UPDATE islands SET last_tick_at=$2 WHERE id=$1", [islandId, now]);

  return {
    type: data.type,
    drop,
    ...(data.type === "feed" && feedItem ? { consumed: { itemId: feedItem.id, name: feedItem.name } } : {}),
    intimacy,
    today,
    inventory: await loadInventory(islandId),
    message,
  };
}

/* ---------- 日记 ---------- */

/**
 * 一条日记的下发形态。
 *
 * 带 `id` 是给端上的列表 key 用的：`wx:key` 不能用 `date` —— 同一天可以同时有
 * 一条 `diary` 与一条 `milestone`（唯一键是 `(island, kind, date)`），
 * 重复的 key 会让小程序复用错节点，表现是翻页后某一条的文案对不上日期。
 */
function mapDiaryRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    date: asDateKey(row.event_date),
    kind: String(row.kind),
    templateId: String(row.template_id),
    text: renderDiary({ templateId: String(row.template_id), payload: (row.payload || {}) as IslandDiaryPayload }),
  };
}

async function loadDiaryOn(islandId: string, dateKey: string) {
  const rows = await (await getDatabase()).query(
    "SELECT id,kind,template_id,payload,event_date FROM island_events WHERE island_id=$1 AND event_date=$2 ORDER BY created_at DESC LIMIT 1",
    [islandId, dateKey],
  );
  return rows[0] ? mapDiaryRow(rows[0]) : undefined;
}

/**
 * 结算今天的日记。**每天一条。**
 *
 * 幂等有**两道**，缺一不可：
 *
 * 1. **先查当日有无任何条目，有就直接返回。** 唯一约束含 `kind`，而模板选择的结果
 *    会随当天的事实变化 —— 上午命中「去年今日」写下 `kind=on_this_day`，下午用户
 *    上传了照片，模板改选 `photo-today-v1`（`kind=diary`），约束拦不住它，
 *    于是同一天出现两条。所以「每天一条」这条产品规则靠这一道保证。
 * 2. **`UNIQUE(island_id, kind, event_date)` 作兜底**（5.6，与 `health_reminders` 的
 *    `(pet_id, kind, subject_key)` 同一手法）：并发请求同时穿过第一道时由它拦住。
 *
 * 正文 5.6 只提了第二道 —— 它对「连续两次请求」够用，但对「当天事实发生变化」不够。
 *
 * **不需要 Worker 定时跑**：岛没有「必须按时发生」的事（4.1 #6/#7 已禁掉掉线惩罚），
 * 懒结算完全够用，且省掉一整轮轮询成本。
 *
 * **只结算当天，不补齐用户不在的那些天。** 正文 5.6 提到「补齐期间的日记条目」，
 * 但那要凭空生成「那天发生了什么」，而我们只有天气是确定的 —— 一句
 * 「它自己待了一会儿」乘以 30 天不是回顾，是灌水。真要做，正确形态是一条汇总
 * （「这几天小岛上下过两场雨」），那要等日记页有翻阅量之后再定。
 */
export async function settleDiary(userId: string, islandId: string, now = new Date()) {
  const database = await getDatabase();
  const dateKey = serverDateKey(now);
  const petRow = await loadIslandPet(islandId);
  if (!petRow) return { written: 0 };

  // 第一道幂等，见函数注释。查任何 kind，不只查即将要写的那个
  const existing = await database.query(
    "SELECT id FROM island_events WHERE island_id=$1 AND event_date=$2 LIMIT 1",
    [islandId, dateKey],
  );
  if (existing[0]) return { written: 0 };

  const petId = String(petRow.pet_id);
  const petName = String(petRow.name);
  const memorialSince = petRow.memorial_since ? iso(petRow.memorial_since) : undefined;
  const days = daysSince(
    anchorOf({ birthday: petRow.birthday ? String(petRow.birthday) : undefined, createdAt: iso(petRow.pet_created_at) }),
    memorialSince,
  );

  const today = await loadToday(islandId, dateKey);

  /*
   * 今天新上传的照片数按 **`created_at`** 计数 —— 那是用户的行为。
   * 用 `shot_at` 会把今天上传的旧照片算成「今天拍的」，而日记里说的是「今天拍了 N 张」。
   * 两套口径不能混（CLAUDE.md）。
   */
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const photoRows = await database.query<{ count: number }>(
    "SELECT count(*)::int count FROM photos WHERE pet_id=$1 AND deleted_at IS NULL AND created_at>=$2 AND created_at<$3",
    [petId, dayStart, dayEnd],
  );

  /*
   * 「去年今日」**只认 `shot_at IS NOT NULL`** —— `findOnThisDay` 已经这么做了，
   * 复用它而不是另写一条 SQL（上传时间的月日撞上今天纯属巧合）。
   * 只取这只宠物的那些：岛上只有它，引用另一只的回忆会让人困惑。
   */
  const matches = (await findOnThisDay(userId, now)).filter((match) => match.petId === petId);

  const ambient = ambientAt(islandId, dateKey, now.getHours());
  const entry = selectDiaryEntry({
    petName,
    days,
    phase: ambient.phase as IslandDayPhase,
    weather: ambient.weather as IslandWeather,
    gathered: today.gathered,
    fed: today.fed,
    petted: today.petted,
    gatheredItems: today.gathered,
    photoCount: Number(photoRows[0]?.count) || 0,
    ...(matches[0] ? { onThisDay: { date: matches[0].date, yearsAgo: matches[0].yearsAgo, day: matches[0].day } } : {}),
  });

  const written = await writeDiaryEntry(islandId, petId, dateKey, entry);
  await database.query("UPDATE islands SET last_tick_at=$2 WHERE id=$1", [islandId, now]);
  return { written };
}

/**
 * 写一条日记。已存在（唯一约束冲突）时返回 0。
 *
 * **写的是 `template_id` + `payload`，不是成品文案**（0024 的表注释）：模板改了措辞
 * 之后历史日记应当跟着修正，而存成品会把违规文案永久固化在库里。
 *
 * 落库前仍过一遍门禁 —— 那是拦「宠物名本身命中词表」这条路径，
 * 与 `submitIslandAction` 出口的理由相同。
 */
async function writeDiaryEntry(islandId: string, petId: string, dateKey: string, entry: IslandDiaryEntry): Promise<number> {
  assertCopySafe(renderDiary(entry), `island diary ${entry.templateId}`);
  const rows = await (await getDatabase()).query(
    "INSERT INTO island_events (id,island_id,pet_id,kind,template_id,payload,event_date,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT (island_id,kind,event_date) DO NOTHING RETURNING id",
    [crypto.randomUUID(), islandId, petId, kindOfTemplate(entry.templateId), entry.templateId, JSON.stringify(entry.payload), dateKey, new Date()],
  );
  return rows[0] ? 1 : 0;
}

const diaryQuerySchema = z.object({
  /** 游标是日期串：日记一天一条，按日期翻页比 offset 稳（中间插进一条不会错位） */
  cursor: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional().default(30),
});

/** 日记翻阅（`GET /api/island/diary`），分页 */
export async function listIslandDiary(userId: string, input: unknown = {}) {
  const options = diaryQuerySchema.parse(input);
  const island = await requireIsland(userId);
  const database = await getDatabase();
  const cursor = options.cursor ? asDateKey(options.cursor) : undefined;
  const rows = cursor
    ? await database.query(
        "SELECT id,kind,template_id,payload,event_date FROM island_events WHERE island_id=$1 AND event_date < $2 ORDER BY event_date DESC LIMIT $3",
        [island.id, cursor, options.limit],
      )
    : await database.query(
        "SELECT id,kind,template_id,payload,event_date FROM island_events WHERE island_id=$1 ORDER BY event_date DESC LIMIT $2",
        [island.id, options.limit],
      );
  const entries = rows.map(mapDiaryRow);
  const nextCursor = entries.length === options.limit ? entries[entries.length - 1].date : undefined;
  return {
    entries,
    /**
     * 下一页游标。少于 limit 条说明到底了。
     *
     * **两个键给同一个值**：端上读的是 `cursor`（`island/diary/diary.js` 写在前，
     * 它按 `result.cursor` 判「还有没有下一页」），而 REST 侧的习惯叫 `nextCursor`。
     * 与其改端上一处、留一个「字段名对不上就静默翻不动页」的坑，不如两个都下发 ——
     * 翻页失效的表现是「日记只有第一页」，不报错，很难发现。
     */
    cursor: nextCursor,
    nextCursor,
  };
}
