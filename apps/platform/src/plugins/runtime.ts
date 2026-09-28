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

const previousArtSceneOptions = [
  { id: "window-morning", title: "窗边晨光", description: "坐姿望窗 · 平静神态" },
  { id: "garden-curious", title: "花园探索", description: "抬爪嗅花 · 好奇神态" },
  { id: "studio-confident", title: "影棚主角", description: "正面坐姿 · 自信凝视" },
  { id: "night-playful", title: "夜色追光", description: "回头跃起 · 惊喜活泼" },
];

const previousV2ArtSceneOptions = [
  { id: "window-morning", title: "窗边观鸟", description: "伏窗望鸟 · 安静专注" },
  { id: "garden-curious", title: "花园探花", description: "抬爪嗅花 · 好奇" },
  { id: "studio-confident", title: "复古影棚", description: "登上木台 · 自信回望" },
  { id: "night-playful", title: "夜庭追光", description: "跃步追光 · 惊喜活泼" },
  { id: "seaside-breeze", title: "海边栈道", description: "迎风站立 · 警觉舒展" },
  { id: "library-whisper", title: "书店探险", description: "转角探身 · 机灵好奇" },
  { id: "autumn-leaves", title: "枫叶小径", description: "轻跑落叶 · 兴奋" },
  { id: "snow-cabin", title: "雪窗木屋", description: "蜷卧毛毯 · 困倦满足" },
  { id: "cafe-afternoon", title: "街角咖啡馆", description: "坐椅转头 · 悠闲观察" },
  { id: "lakeside-sunset", title: "湖畔木桥", description: "伸懒腰 · 眯眼迎光" },
  { id: "city-rain", title: "雨后骑楼", description: "跨过水洼 · 惊讶" },
  { id: "spring-picnic", title: "春日野餐", description: "伸爪拨带 · 轻快愉悦" },
];

const previousSampleDefaults: Record<string, { heroUrl?: string; styleUrls?: Record<string, string>; sceneUrls?: Record<string, string> }> = {
  "pet-id-card": { heroUrl: "/api/plugin-samples/samples/pet-id-card-cee27b346c67.jpg" },
  "pet-movie-poster": { heroUrl: "/api/plugin-samples/samples/pet-movie-poster-d49f06ae0fdf.jpg" },
  "pet-time-album": { heroUrl: "/api/plugin-samples/samples/pet-time-album-a56e5316f509.jpg" },
  "pl-10": {
    heroUrl: "/api/plugin-samples/samples/pl-10-df4b766033ec.jpg",
    sceneUrls: {
      "window-morning": "/api/plugin-samples/samples/scene-window-morning-v1-9770823ac40a.jpg",
      "garden-curious": "/api/plugin-samples/samples/scene-garden-curious-v1-d4fa01fd949b.jpg",
      "studio-confident": "/api/plugin-samples/samples/scene-studio-confident-v1-0eaea2bc2fc0.jpg",
      "night-playful": "/api/plugin-samples/samples/scene-night-playful-v1-7057658d097e.jpg",
    },
    styleUrls: {
      "warm-film": "/api/plugin-samples/samples/style-warm-film-745db4c3d705.jpg",
      "paper-cut": "/api/plugin-samples/samples/style-paper-cut-e6ab5e0ba3d3.jpg",
      studio: "/api/plugin-samples/samples/style-studio-9006fcd75888.jpg",
      fantasy: "/api/plugin-samples/samples/style-fantasy-aae6d3e4c431.jpg",
    },
  },
  "pl-15": { heroUrl: "/api/plugin-samples/samples/pl-15-2b583f83d80c.jpg" },
  "pl-19": { heroUrl: "/api/plugin-samples/samples/pl-19-c88acc8d9d43.jpg" },
};

const previousV2SampleDefaults: Record<string, { heroUrl?: string; sceneUrls?: Record<string, string> }> = {
  "pl-10": {
    heroUrl: "/api/plugin-samples/samples/mp26-pl-10-8bfc17d3b3b5.jpg",
    sceneUrls: {
      "window-morning": "/api/plugin-samples/samples/scene-window-morning-v2-76d6e35bcd80.jpg",
      "garden-curious": "/api/plugin-samples/samples/scene-garden-curious-v2-6afe0ff901ac.jpg",
      "studio-confident": "/api/plugin-samples/samples/scene-studio-confident-v2-52ea373449b2.jpg",
      "night-playful": "/api/plugin-samples/samples/scene-night-playful-v2-4e6edc0635d4.jpg",
      "seaside-breeze": "/api/plugin-samples/samples/scene-seaside-breeze-v2-5d97dde2ceff.jpg",
      "library-whisper": "/api/plugin-samples/samples/scene-library-whisper-v2-2a60ecd39569.jpg",
      "autumn-leaves": "/api/plugin-samples/samples/scene-autumn-leaves-v2-1885e1d0a87d.jpg",
      "snow-cabin": "/api/plugin-samples/samples/scene-snow-cabin-v2-6efe37c5381b.jpg",
      "cafe-afternoon": "/api/plugin-samples/samples/scene-cafe-afternoon-v2-47cc12cccf0a.jpg",
      "lakeside-sunset": "/api/plugin-samples/samples/scene-lakeside-sunset-v3-1e2beeb35285.jpg",
      "city-rain": "/api/plugin-samples/samples/scene-city-rain-v2-a33c5af764c0.jpg",
      "spring-picnic": "/api/plugin-samples/samples/scene-spring-picnic-v3-eed947ea641e.jpg",
    },
  },
  "pl-15": { heroUrl: "/api/plugin-samples/samples/mp26-pl-15-bd5db2c1f693.jpg" },
};

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
    sceneUrls: z.record(z.string().max(40), z.string().max(500).regex(/^\/api\/plugin-samples\//)).optional(),
    sceneOptions: z.array(z.object({ id: z.string().min(1).max(40), title: z.string().min(1).max(80), description: z.string().max(180) })).max(24).optional(),
    // 旧 AI 风格对照字段，仅供历史 manifest 和回滚读取。
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

function matchesArtSceneOptions(value: unknown, options: typeof previousV2ArtSceneOptions) {
  return Array.isArray(value) && value.length === options.length
    && value.every((item, index) => {
      const current = asRecord(item);
      const previous = options[index];
      return current.id === previous.id && current.title === previous.title && current.description === previous.description;
    });
}

function matchesPreviousArtScenes(value: unknown) {
  return matchesArtSceneOptions(value, previousArtSceneOptions) || matchesArtSceneOptions(value, previousV2ArtSceneOptions);
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
          // 仅替换上一版代码的默认 URL；不同值视为后台人工配置，保持原样。
          const storedSamples = asRecord(manifest.samples);
          const merged = { ...storedSamples };
          let changed = false;
          for (const [key, value] of Object.entries(plugin.samples)) {
            if (key === "styleUrls" || key === "sceneUrls") {
              const currentStyles = asRecord(merged[key]);
              const nextStyles = { ...currentStyles };
              const oldStyles = previousSampleDefaults[plugin.id]?.[key] || {};
              const v2Styles = key === "sceneUrls" ? previousV2SampleDefaults[plugin.id]?.sceneUrls || {} : {};
              for (const [style, url] of Object.entries(value as Record<string, string>)) {
                if (nextStyles[style] === undefined || nextStyles[style] === oldStyles[style] || nextStyles[style] === v2Styles[style]) {
                  if (nextStyles[style] !== url) { nextStyles[style] = url; changed = true; }
                }
              }
              merged[key] = nextStyles;
            } else if (key === "sceneOptions") {
              const previousTwelve = (value as typeof previousV2ArtSceneOptions).slice(0, 12);
              if (merged[key] === undefined || matchesPreviousArtScenes(merged[key]) || matchesArtSceneOptions(merged[key], previousTwelve)) { merged[key] = value; changed = true; }
            } else if (value !== undefined && (merged[key] === undefined || merged[key] === previousSampleDefaults[plugin.id]?.[key as "heroUrl"] || merged[key] === previousV2SampleDefaults[plugin.id]?.[key as "heroUrl"])) {
              if (merged[key] !== value) { merged[key] = value; changed = true; }
            }
          }
          if (changed) {
            await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify({ ...manifest, samples: merged }), new Date()]);
          }
        }
      }
    }
    if (plugin.id === "pl-10") {
      const stored = (await database.query<{ manifest: unknown }>("SELECT manifest FROM plugin_configs WHERE id=$1", [plugin.id]))[0];
      if (stored) {
        const manifest = asRecord(stored.manifest);
        const oldCopy: Record<string, string> = {
          name: "AI 宠物肖像",
          tagline: "四张候选，只留下最像它的一张",
          description: "选择宠物照片、风格与提示词，生成四张带 AI 标识的候选肖像。",
        };
        const next = { ...manifest };
        let changed = false;
        for (const key of Object.keys(oldCopy)) {
          if (next[key] === oldCopy[key]) {
            next[key] = plugin[key as "name" | "tagline" | "description"];
            changed = true;
          }
        }
        if (next.description === "选择宠物身份照和写真场景，生成四张保留它真实身份的艺术写真候选。") {
          next.description = plugin.description;
          changed = true;
        }
        if (changed) await database.query("UPDATE plugin_configs SET manifest=$2::jsonb,updated_at=$3 WHERE id=$1", [plugin.id, JSON.stringify(next), new Date()]);
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
