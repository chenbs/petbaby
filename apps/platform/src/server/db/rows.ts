import type { AiRun, FunnelEvent, GenerationTask, Order, OwnerPhoto, Pet, Photo, Work } from "@/domain/models";

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * 把 jsonb 列读出来的「字符串 id 数组」归一成真数组。
 *
 * 为什么需要它：`row.photo_ids as string[]` 是纯类型断言，运行时什么都不做。
 * 驱动若把 jsonb 交回字符串，值就一路带着 `["uuid"]` 的形态流到
 * `id = ANY($1::uuid[])`，PostgreSQL 报 `malformed array literal` ——
 * 因为 PG 的数组字面量是 `{...}`，`[...]` 是 JSON 的写法。
 *
 * 这个坑只在真 PostgreSQL 上暴露、本地 PGlite 不会，所以类型系统和本地测试
 * 都拦不住它。凡是从 jsonb 读 id 数组的地方都走这里，不要再写裸断言。
 */
export function jsonIdArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * jsonb 对象列的同类归一。受影响的不止数组：`plugin_snapshot` 若是字符串，
 * `task.pluginSnapshot || fallback` 会判定为真值，随后 `plugin.name` 得到
 * undefined —— 比数组那处更难查，因为报错会出现在下游好几步之后。
 *
 * @param value 驱动返回的 jsonb 值
 * @param fallback 解析不出对象时的兜底；传 undefined 可保留「快照缺失」语义，
 *        让调用方的 `|| 取运行时配置` 分支正常生效。
 */
export function jsonObject<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function mapPet(row: Record<string, unknown>): Pet {
  return {
    id: String(row.id), userId: String(row.user_id), name: String(row.name),
    species: row.species as Pet["species"], gender: row.gender as Pet["gender"],
    birthday: row.birthday ? String(row.birthday) : undefined, createdAt: iso(row.created_at),
    avatarKey: row.avatar_key ? String(row.avatar_key) : undefined,
    avatarUrl: row.avatar_key ? `/api/media/${encodeURIComponent(String(row.avatar_key))}` : undefined,
    dateType: (row.date_type || "birthday") as Pet["dateType"],
    lifeStage: (row.life_stage || "active") as Pet["lifeStage"],
    isDefault: Boolean(row.is_default), deletedAt: row.deleted_at ? iso(row.deleted_at) : undefined,
  };
}

export function mapPhoto(row: Record<string, unknown>): Photo {
  return {
    id: String(row.id), userId: String(row.user_id), petId: String(row.pet_id),
    filename: String(row.filename), mimeType: String(row.mime_type), size: Number(row.size),
    storageKey: String(row.storage_key), url: `/api/media/${encodeURIComponent(String(row.storage_key))}`,
    createdAt: iso(row.created_at), position: Number(row.position || 0),
    /*
     * 拍摄时间。历史照片与截图没有 EXIF，`shot_at` 为 NULL 时回落到上传时间 ——
     * 时间线与年度视频都直接用这个字段排序，留空会让它们排到 1970。
     * 回落只发生在读取侧：写入侧（savePhoto）取不到 EXIF 就存 NULL，
     * 这样「真实拍摄时间」与「只有上传时间」在库里仍然可区分。
     */
    shotAt: iso(row.shot_at || row.created_at),
    shotAtSource: row.shot_at ? "exif" : "upload",
    quality: (row.quality || "unknown") as Photo["quality"], deletedAt: row.deleted_at ? iso(row.deleted_at) : undefined,
  };
}

export function mapOwnerPhoto(row: Record<string, unknown>): OwnerPhoto {
  return {
    id: String(row.id), userId: String(row.user_id), filename: String(row.filename), mimeType: String(row.mime_type), size: Number(row.size),
    quality: (row.quality || "unknown") as OwnerPhoto["quality"],
    url: `/api/owner-photos/${encodeURIComponent(String(row.id))}/media`,
    authorizationConfirmedAt: iso(row.authorization_confirmed_at), createdAt: iso(row.created_at),
    deletedAt: row.deleted_at ? iso(row.deleted_at) : undefined,
  };
}

export function mapAiRoleInputs(value: unknown): AiRun["roleInputs"] {
  const parsed = jsonObject<Record<string, unknown>>(value, {});
  const subjectMode = ["pet", "owner-pet", "pet-human"].includes(String(parsed.subjectMode))
    ? parsed.subjectMode as AiRun["roleInputs"]["subjectMode"] : "pet";
  return {
    subjectMode,
    templateId: typeof parsed.templateId === "string" ? parsed.templateId : undefined,
    templateVersion: typeof parsed.templateVersion === "string" ? parsed.templateVersion : undefined,
    ownerPhotoIds: jsonIdArray(parsed.ownerPhotoIds),
    petPhotoIds: jsonIdArray(parsed.petPhotoIds),
    authorizationConfirmed: parsed.authorizationConfirmed === true,
    petHumanIdentityId: typeof parsed.petHumanIdentityId === "string" ? parsed.petHumanIdentityId : undefined,
    petHumanIdentityPromptVersion: typeof parsed.petHumanIdentityPromptVersion === "string" ? parsed.petHumanIdentityPromptVersion : undefined,
    rerollReason: ["owner-not-like", "pet-not-like", "too-animal", "composition"].includes(String(parsed.rerollReason))
      ? parsed.rerollReason as AiRun["roleInputs"]["rerollReason"] : undefined,
  };
}

export function mapTask(row: Record<string, unknown>): GenerationTask {
  return {
    id: String(row.id), userId: String(row.user_id), pluginId: String(row.plugin_id),
    petId: String(row.pet_id), photoIds: jsonIdArray(row.photo_ids), idempotencyKey: String(row.idempotency_key),
    status: row.status as GenerationTask["status"], progress: Number(row.progress), attempt: Number(row.attempt),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    workId: row.work_id ? String(row.work_id) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    sourceWorkId: row.source_work_id ? String(row.source_work_id) : undefined,
    options: jsonObject<Record<string, unknown>>(row.options, {}),
    pluginSnapshot: jsonObject<GenerationTask["pluginSnapshot"]>(row.plugin_snapshot, undefined),
  };
}

export function mapWork(row: Record<string, unknown>): Work {
  return {
    id: String(row.id), userId: String(row.user_id), pluginId: String(row.plugin_id),
    petId: String(row.pet_id), photoId: String(row.photo_id), title: String(row.title),
    subtitle: String(row.subtitle), serialNumber: String(row.serial_number), authority: String(row.authority),
    outputKey: row.output_key ? String(row.output_key) : undefined,
    previewKey: row.preview_key ? String(row.preview_key) : undefined,
    assetKind: (row.asset_kind || "image") as Work["assetKind"],
    sourceKind: row.source_kind ? row.source_kind as Work["sourceKind"] : undefined,
    sourceId: row.source_id ? String(row.source_id) : undefined,
    locked: Boolean(row.locked), public: Boolean(row.public),
    shareToken: row.share_token ? String(row.share_token) : undefined, createdAt: iso(row.created_at),
    shareExpiresAt: row.share_expires_at ? iso(row.share_expires_at) : undefined,
    shareProtected: Boolean(row.share_access_code_hash),
    version: Number(row.version || 1), expiresAt: row.expires_at ? iso(row.expires_at) : undefined,
    deletedAt: row.deleted_at ? iso(row.deleted_at) : undefined,
  };
}

export function mapOrder(row: Record<string, unknown>): Order {
  return {
    id: String(row.id), userId: String(row.user_id), workId: String(row.work_id),
    pluginId: String(row.plugin_id), amount: Number(row.amount), status: row.status as Order["status"],
    createdAt: iso(row.created_at), paidAt: row.paid_at ? iso(row.paid_at) : undefined,
    closedAt: row.closed_at ? iso(row.closed_at) : undefined,
    refundedAmount: Number(row.refunded_amount || 0),
    refundReason: row.refund_reason ? String(row.refund_reason) : undefined,
    sku: String(row.sku || `${String(row.plugin_id)}-single`),
    unitPrice: Number(row.unit_price || row.amount),
    entitlements: jsonObject<Record<string, unknown>>(row.entitlements, {}),
    pluginSnapshot: jsonObject<Order["pluginSnapshot"]>(row.plugin_snapshot, undefined),
  };
}

export function mapEvent(row: Record<string, unknown>): FunnelEvent {
  return {
    id: String(row.id), userId: String(row.user_id), pluginId: row.plugin_id ? String(row.plugin_id) : undefined,
    name: String(row.name), createdAt: iso(row.created_at),
  };
}
