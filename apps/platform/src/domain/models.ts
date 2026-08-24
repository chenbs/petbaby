import { z } from "zod";

export const speciesSchema = z.enum(["cat", "dog", "other"]);

export const petInputSchema = z.object({
  name: z.string().trim().min(1, "请填写宠物名字").max(20),
  species: speciesSchema,
  gender: z.enum(["female", "male", "unknown"]).default("unknown"),
  birthday: z.string().date().optional().or(z.literal("")),
  dateType: z.enum(["birthday", "got_home"]).default("birthday"),
  /*
   * 三态而非两态。`senior`（晚年）是 2026-08-03 新增：
   * 原先从「陪伴中」直接跳到「已离开」，中间那段最需要陪伴的时间产品是缺席的，
   * 而纪念线可达性与画册/短片的调性切换都要靠它判断。
   *
   * **只能用户手动设置，不按年龄自动推断** —— 品种间寿命差异极大，
   * 自动把 7 岁的猫标成晚年是冒犯。
   */
  lifeStage: z.enum(["active", "senior", "memorial"]).default("active"),
});

export const photoInputSchema = z.object({
  petId: z.string().min(1),
  filename: z.string().min(1).max(120),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(2_500_000),
});

export const generationInputSchema = z.object({
  pluginId: z.string().min(1),
  petId: z.string().min(1),
  photoIds: z.array(z.string().min(1)).min(1).max(20),
  idempotencyKey: z.string().min(8).max(100),
  sourceWorkId: z.string().uuid().optional(),
  options: z.object({
    style: z.enum(["classic", "arthouse", "hongkong"]).optional(),
    composition: z.enum(["portrait", "closeup", "ensemble"]).optional(),
    review: z.string().trim().max(120).optional(),
    voice: z.enum(["pet", "owner"]).optional(),
    documentType: z.enum(["identity", "passport", "household", "vaccine", "bundle"]).optional(),
    theme: z.enum(["growth", "birthday", "healing", "holiday"]).optional(),
    title: z.string().trim().min(1).max(60).optional(),
    subtitle: z.string().trim().min(1).max(120).optional(),
    coverTitle: z.string().trim().max(60).optional(),
    pageCaptions: z.array(z.string().trim().max(120)).max(20).optional(),
  }).default({}),
});

export const workEditSchema = z.object({
  title: z.string().trim().min(1).max(60),
  subtitle: z.string().trim().min(1).max(120),
});

export type Species = z.infer<typeof speciesSchema>;
export type PetInput = z.infer<typeof petInputSchema>;

export type PluginManifest = {
  id: string;
  code: string;
  name: string;
  category: "layout" | "ai-image" | "interactive" | "video" | "memorial" | "report";
  tagline: string;
  description: string;
  accent: "orange" | "blue" | "yellow";
  input: {
    photos: { min: number; max: number };
    profileFields: Array<"name" | "species" | "birthday" | "gender">;
  };
  generator: {
    type: "html-template" | "image-api" | "h5-theme" | "ffmpeg" | "report";
    template: string;
  };
  pricing: {
    unlockPrice: number;
    label: string;
  };
  output: {
    formats: Array<"image" | "pdf" | "h5" | "video">;
  };
  /**
   * 样例图：玩法入口展示的真实成品（UI 重构方案 3.3 / 4.1）。
   *
   * 小程序首屏改为大图入口后，「这个玩法能做出什么」必须靠成品图回答，文字说明做不到。
   * 图必须是本玩法生成器的真实产出，不能用素材图或抽象色块顶替。
   *
   * 可选而非必填：plugin_configs 里已有的行是按旧结构写入的，
   * ensurePluginConfigs 用 ON CONFLICT DO NOTHING 不会覆盖它们，
   * 设为必填会让 listRuntimePlugins 解析历史行时直接抛错。
   */
  samples?: {
    /** 入口主图，16:10。列表页与首屏 Hero 都用它。站内相对路径 */
    heroUrl?: string;
    /** 网格缩略图，3:4。同一玩法的多种产出，用于入口下方的横向 rail */
    thumbUrls?: string[];
    /**
     * 风格对比图，3:4。键为 style 枚举值（warm-film / paper-cut / studio / fantasy）。
     *
     * 方案 3.3 的硬规则：这组图必须是**同一只样板宠物**在不同风格下的产出。
     * 用户在这里比较的是「风格」，换了宠物就变成比较宠物，选择依据当场失效。
     * 抽象渐变色块同理不合格 —— 色块回答不了「我的狗做出来长什么样」。
     */
    styleUrls?: Record<string, string>;
  };
  /**
   * 按生命阶段切换的文案与定价（2026-08-03，产品改造方案 C4）。
   *
   * 用来把「时光画册 / 纪念册」「记忆短片 / 纪念视频」「互动页 / 纪念页」
   * 三组各自合并成一个玩法 —— 它们本来就走同一个生成器，
   * 原先是同一能力的两次换皮，让首页多出三张卡、把选择成本抬高。
   *
   * 用户不需要区分「时光画册」和「纪念册」，他们只想给自己的宠物做一本册子，
   * 而册子该是什么调性，**产品应该自己知道**。
   *
   * 这同时解决了纪念线的两难：首页只有「宠物画册」一张卡（不做纪念曝光），
   * 而宠物是 memorial 时做出来的自然是纪念册（需要的人找得到）。
   *
   * 选择「一个 manifest 带多套文案」而不是「每个阶段一个 manifest」：
   * 后者会把 manifest 从 10 变成 21，与「减少数量」的目标相反，
   * 且赛马变体（experiment_variants）会跟着乘以 3。
   */
  toneVariants?: {
    senior?: PluginToneVariant;
    memorial?: PluginToneVariant;
  };
  status: "idea" | "testing" | "live" | "archived";
};

/** 单个生命阶段的文案与定价覆盖。未给的字段回落到 manifest 本体。 */
export type PluginToneVariant = {
  name?: string;
  tagline?: string;
  description?: string;
  unlockPrice?: number;
  label?: string;
};

export type Pet = PetInput & {
  id: string;
  userId: string;
  createdAt: string;
  avatarKey?: string;
  avatarUrl?: string;
  isDefault: boolean;
  deletedAt?: string;
  /**
   * 关联计数，供 UI 重构方案 E 的统计条使用（「12 作品 · 86 照片 · 2 纪念日」）。
   * 只有 listPets 会填；单条查询的返回值里没有这个字段，故为可选。
   */
  counts?: { works: number; photos: number; memorials: number };
  /**
   * 离开日期（最早的纪念空间创建时间）。端上用它把陪伴天数固定住：
   * 已离开的宠物显示「陪伴了 N 天」且不再递增。仅 memorial 阶段的宠物有值。
   */
  memorialSince?: string;
};

export type Photo = {
  id: string;
  userId: string;
  petId: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  url: string;
  createdAt: string;
  /**
   * 拍摄时间。来自 EXIF；没有 EXIF 时读取侧回落为 `createdAt`（上传时间），
   * 所以这个字段永远有值，可以直接排序。
   *
   * 成长时间线、去年今日、叙事视频的日期全部取这里 —— 用 `createdAt` 会把
   * 「第 1 天」错记成用户建档那天。
   */
  shotAt: string;
  /** `shotAt` 的来源。`upload` 表示这张照片没有 EXIF，日期只是上传时间，不能当拍摄事实展示 */
  shotAtSource: "exif" | "upload";
  position: number;
  quality?: "unknown" | "clear" | "blurry";
  deletedAt?: string;
};

export type OwnerPhoto = {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  size: number;
  quality: "unknown" | "clear" | "blurry";
  url: string;
  authorizationConfirmedAt: string;
  createdAt: string;
  deletedAt?: string;
};

export type GenerationTask = {
  id: string;
  userId: string;
  pluginId: string;
  petId: string;
  photoIds: string[];
  idempotencyKey: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  progress: number;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  workId?: string;
  errorCode?: string;
  sourceWorkId?: string;
  options: Record<string, unknown>;
  pluginSnapshot?: PluginManifest;
  queuePosition?: number;
  estimatedSeconds?: number;
};

export type Work = {
  id: string;
  userId: string;
  pluginId: string;
  petId: string;
  photoId: string;
  title: string;
  subtitle: string;
  serialNumber: string;
  authority: string;
  outputKey?: string;
  previewKey?: string;
  /**
   * 产物形态。`pdf` 是纪念册这类「可长期保存的文件」——
   * `<Image>` 与 `<video>` 都渲染不了它，端上要走下载而不是内嵌预览。
   */
  assetKind: "image" | "video" | "h5" | "pdf";
  sourceKind?: "generation" | "ai" | "interactive" | "video" | "memorial" | "report";
  sourceId?: string;
  locked: boolean;
  public: boolean;
  shareToken?: string;
  shareExpiresAt?: string;
  shareProtected?: boolean;
  version: number;
  expiresAt?: string;
  createdAt: string;
  deletedAt?: string;
};

export type Order = {
  id: string;
  userId: string;
  workId: string;
  pluginId: string;
  amount: number;
  status: "pending" | "paid" | "closed" | "refunded";
  createdAt: string;
  paidAt?: string;
  closedAt?: string;
  refundedAmount: number;
  refundReason?: string;
  sku: string;
  unitPrice: number;
  entitlements: Record<string, unknown>;
  pluginSnapshot?: PluginManifest;
};

export type Refund = {
  id: string;
  userId: string;
  orderId: string;
  amount: number;
  reason: "generation_failed" | "dissatisfied";
  status: "pending" | "succeeded" | "failed";
  createdAt: string;
  completedAt?: string;
};

export type FunnelEvent = {
  id: string;
  userId: string;
  pluginId?: string;
  name: string;
  createdAt: string;
};

export type PublicWork = Work & {
  pet: Pet;
  photo: Photo;
  plugin: PluginManifest;
  outputUrl?: string;
};

export type AiRun = {
  id: string;
  userId: string;
  pluginId: string;
  petId: string;
  photoIds: string[];
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  candidates: Array<{ id: string; outputKey?: string; previewKey?: string; aiGenerated: true }>;
  selectedId?: string;
  selectedUnlocked?: boolean;
  provider?: string;
  modelVersion?: string;
  prompt: string;
  promptVersion: string;
  options: Record<string, unknown>;
  roleInputs: {
    subjectMode: "pet" | "owner-pet" | "pet-human";
    templateId?: string;
    templateVersion?: string;
    ownerPhotoIds: string[];
    petPhotoIds: string[];
    authorizationConfirmed: boolean;
    petHumanIdentityId?: string;
    petHumanIdentityPromptVersion?: string;
    rerollReason?: "owner-not-like" | "pet-not-like" | "too-animal" | "composition";
  };
  errorCode?: string;
  cost: number;
  attempt: number;
  retryCount: number;
  rerollCount: number;
  rerollRemaining: number;
  queuePosition?: number;
  estimatedSeconds?: number;
  workId?: string;
  order?: Order;
  createdAt: string;
};
export type InteractiveSession = {
  id: string;
  userId: string;
  pluginId: string;
  petId: string;
  photoIds: string[];
  state: "active" | "exporting" | "ready" | "failed";
  snapshot: Record<string, unknown>;
  shareToken?: string;
  sharePath?: string;
  shareExpiresAt?: string;
  revokedAt?: string;
  exportedKey?: string;
  exportRenderId?: string;
  exportStatus?: VideoRender["status"];
  exportProgress?: number;
  workId?: string;
  createdAt: string;
  updatedAt: string;
};
export type VideoRender = { id: string; userId: string; pluginId: string; status: "queued" | "processing" | "preview_ready" | "ready" | "failed" | "cancelled"; progress: number; outputKey?: string; workId?: string; errorCode?: string; createdAt: string };
export type Membership = { id: string; userId: string; plan: "monthly" | "yearly"; status: "pending" | "trial" | "active" | "past_due" | "expired"; quota: number; used: number; expiresAt: string; orderId?: string };
export type AccountProfile = { id: string; displayName?: string; createdAt: string };
