import "server-only";

import { z } from "zod";

import type { PluginManifest } from "@/domain/models";
import { plugins } from "@/plugins/registry";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { recordAdminAudit } from "@/server/admin/audit";

const toneVariantSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  tagline: z.string().max(160).optional(),
  description: z.string().max(1000).optional(),
  unlockPrice: z.number().nonnegative().optional(),
  label: z.string().min(1).max(80).optional(),
});

const manifestSchema: z.ZodType<PluginManifest> = z.object({
  id: z.string().min(1).max(80),
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  category: z.enum(["layout", "ai-image", "interactive", "video", "memorial", "report"]),
  tagline: z.string().max(160),
  description: z.string().max(1000),
  accent: z.enum(["orange", "blue", "yellow"]),
  input: z.object({ photos: z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }).refine((value) => value.max >= value.min), profileFields: z.array(z.enum(["name", "species", "birthday", "gender"])) }),
  generator: z.object({ type: z.enum(["html-template", "image-api", "h5-theme", "ffmpeg", "report"]), template: z.string().min(1).max(120) }),
  pricing: z.object({ unlockPrice: z.number().nonnegative(), label: z.string().min(1).max(80) }),
  output: z.object({ formats: z.array(z.enum(["image", "pdf", "h5", "video"])).min(1) }),
  // 样例图。必须与 models.ts 的 PluginManifest 同步 —— 缺了这条 schema 会把新字段直接剥掉，
  // 后台存进去也读不出来。上限 8 张，避免入口 rail 无限拉长。
  // 存站内相对路径而非绝对 URL：绝对 URL 会把部署域名写进仓库，测试与生产就得各留一份。
  // 小程序需要的绝对地址由 /api/plugins 出口按 PUBLIC_APP_URL 拼装（见该路由）。
  samples: z.object({
    heroUrl: z.string().max(500).regex(/^\/api\/plugin-samples\//).optional(),
    thumbUrls: z.array(z.string().max(500).regex(/^\/api\/plugin-samples\//)).max(8).optional(),
    // 风格对比图：键是 growth-service 里的 style 枚举值，值是同一只样板宠物在该风格下的产出。
    // 用映射而非 thumbUrls 的下标顺序 —— 顺序约定一旦和前端 STYLES 数组错开，
    // 用户看到的就是「张冠李戴」的风格预览，而这种错位不会报错、只会静默骗人。
    styleUrls: z.record(z.string().max(40), z.string().max(500).regex(/^\/api\/plugin-samples\//)).optional(),
  }).optional(),
  // 生命阶段调性覆盖。同 samples：必须与 models.ts 的 PluginManifest 同步 ——
  // 缺了这条 schema 会把字段直接剥掉，registry 里写了也读不出来。
  toneVariants: z.object({
    senior: toneVariantSchema.optional(),
    memorial: toneVariantSchema.optional(),
  }).optional(),
  status: z.enum(["idea", "testing", "live", "archived"]),
});

/**
 * 按生命阶段解析 manifest 的文案与定价。
 *
 * **任务入库时快照的必须是解析后的结果**（见 platform-service 的 plugin_snapshot）：
 * 存含全部 variants 的原始件会让历史作品在用户改了宠物生命阶段后换一副面孔，
 * 而作品是既成事实，不该回头变样。
 */
export function resolveManifestTone(manifest: PluginManifest, lifeStage?: string): PluginManifest {
  const variant = lifeStage === "memorial" ? manifest.toneVariants?.memorial : lifeStage === "senior" ? manifest.toneVariants?.senior : undefined;
  if (!variant) return manifest;
  return {
    ...manifest,
    name: variant.name ?? manifest.name,
    tagline: variant.tagline ?? manifest.tagline,
    description: variant.description ?? manifest.description,
    pricing: {
      unlockPrice: variant.unlockPrice ?? manifest.pricing.unlockPrice,
      label: variant.label ?? manifest.pricing.label,
    },
  };
}

function decodeJsonValue(value: unknown) {
  let decoded = value;
  for (let depth = 0; depth < 2 && typeof decoded === "string"; depth += 1) {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      break;
    }
  }
  return decoded;
}

function asRecord(value: unknown): Record<string, unknown> {
  const decoded = decodeJsonValue(value);
  return decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : {};
}

async function ensurePluginConfigs() {
  const database = await getDatabase();
  for (const plugin of plugins) {
    await database.query("INSERT INTO plugin_configs (id,manifest,version,active,updated_at) VALUES ($1,$2::jsonb,1,true,$3) ON CONFLICT (id) DO NOTHING", [plugin.id, JSON.stringify(plugin), new Date()]);
    // 样例图回填：老库里的 manifest 按旧结构写入，而上面的 DO NOTHING 不会更新它们。
    // 只在「库里没有 samples 而代码里有」时补一次，不整体覆盖 —— 后台发布过的配置属于
    // 运营决策，不能被一次部署重置。
    //
    // 走 JS 而不用 jsonb_set：manifest 列可能存的是 JSON 字符串而非 jsonb 对象
    // （decodeJsonValue 要循环解两层就是为此），那种行上 `manifest ? 'samples'` 会误判。
    if (plugin.samples) {
      const stored = (await database.query<{ manifest: unknown }>("SELECT manifest FROM plugin_configs WHERE id=$1", [plugin.id]))[0];
      if (stored) {
        const manifest = asRecord(stored.manifest);
        if (manifest.id) {
          // 逐键回填而非整块判断：老库里可能已经有 samples.heroUrl（上一次部署补的），
          // 若按「有 samples 就跳过」处理，后来新增的 styleUrls 永远进不去已有行。
          // 仍然只补「库里缺的键」，已有值一律不动 —— 那些是运营在后台改过的。
          const storedSamples = asRecord(manifest.samples);
          const merged = { ...storedSamples };
          let changed = false;
          for (const [key, value] of Object.entries(plugin.samples)) {
            if (value !== undefined && merged[key] === undefined) { merged[key] = value; changed = true; }
          }
          if (changed) {
            await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify({ ...manifest, samples: merged }), new Date()]);
          }
        }
      }
    }
    await database.query("INSERT INTO plugin_config_versions (id,plugin_id,version,manifest,template_version,created_at) VALUES ($1,$2,1,$3::jsonb,$4,$5) ON CONFLICT (plugin_id,version) DO NOTHING", [crypto.randomUUID(), plugin.id, JSON.stringify(plugin), plugin.generator.template, new Date()]);
  }
  return database;
}

export async function listRuntimePlugins() {
  const database = await ensurePluginConfigs();
  const rows = await database.query("SELECT manifest FROM plugin_configs WHERE active=true ORDER BY id");
  const variants = await database.query("SELECT DISTINCT ON (plugin_id) plugin_id,status,config FROM experiment_variants WHERE status='live' ORDER BY plugin_id,updated_at DESC,created_at DESC");
  const byPlugin = new Map(variants.map((row) => [String(row.plugin_id), row]));
  return rows.map((row) => manifestSchema.parse(decodeJsonValue(row.manifest))).flatMap((manifest) => {
    const variant = byPlugin.get(manifest.id);
    if (!variant) return [manifest];
    const config = asRecord(variant.config);
    return [manifestSchema.parse(config.manifest || { ...manifest, ...(config.manifestPatch as object || {}) })];
  });
}

export async function getRuntimePlugin(id: string) {
  return (await listRuntimePlugins()).find((plugin) => plugin.id === id);
}

export async function listRuntimePluginVersions(id: string) {
  const database = await ensurePluginConfigs();
  const rows = await database.query("SELECT id,plugin_id,version,manifest,template_version,created_by,created_at FROM plugin_config_versions WHERE plugin_id=$1 ORDER BY version DESC", [id]);
  return rows.map((row) => ({ ...row, manifest: manifestSchema.parse(decodeJsonValue(row.manifest)) }));
}

export async function updateRuntimePlugin(id: string, input: unknown, actorId?: string, reason = "发布玩法配置") {
  const manifest = manifestSchema.parse(input);
  if (manifest.id !== id) throw new AppError("PLUGIN_ID_MISMATCH", "插件 ID 与路由不一致", 422);
  const database = await ensurePluginConfigs();
  const before = (await database.query("SELECT manifest,version FROM plugin_configs WHERE id=$1", [id]))[0];
  const rows = await database.query("INSERT INTO plugin_configs (id,manifest,version,active,updated_at) VALUES ($1,$2::jsonb,1,true,$3) ON CONFLICT (id) DO UPDATE SET manifest=$2::jsonb,version=plugin_configs.version+1,updated_at=$3 RETURNING version", [id, JSON.stringify(manifest), new Date()]);
  const version = Number(rows[0].version);
  await database.query("INSERT INTO plugin_config_versions (id,plugin_id,version,manifest,template_version,created_by,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)", [crypto.randomUUID(), id, version, JSON.stringify(manifest), manifest.generator.template, actorId || null, new Date()]);
  if (actorId) await recordAdminAudit({ actorId, action: "plugin_publish", targetType: "plugin", targetId: id, reason, before, after: { manifest, version } });
  return { manifest, version };
}

export async function rollbackRuntimePlugin(id: string, version: number, actorId: string, reason = "回滚玩法配置") {
  const database = await ensurePluginConfigs();
  const rows = await database.query("SELECT manifest FROM plugin_config_versions WHERE plugin_id=$1 AND version=$2", [id, version]);
  if (!rows[0]) throw new AppError("PLUGIN_VERSION_NOT_FOUND", "插件历史版本不存在", 404);
  return updateRuntimePlugin(id, decodeJsonValue(rows[0].manifest), actorId, reason);
}
