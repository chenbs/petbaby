import "server-only";

import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

/*
 * 生成内容标识义务确认（《人工智能生成合成内容标识办法》第九条）。
 *
 * 保存到相册的原图上没有可见标识，只有文件元数据。所以用户第一次保存生成类原图前，
 * 要确认一次「自己发布时按平台要求标注」。每次实际交付原图，也记一条交付日志。
 * 这两类记录都不参与自动清理，至少保留 6 个月。
 *
 * 文案改动必须同时升级 POLICY_VERSION：否则按旧文案确认过的用户，
 * 会被当成已经同意了新文案。
 */
export const AI_DISCLOSURE_POLICY_VERSION = "2026-09-v1";
export const AI_DISCLOSURE_TEXT = "保存下来的图片上不带可见的 AI 标识。你自己发布或转发时，请按平台要求标注为 AI 生成内容。";

export type OriginalDeliveryKind = "work" | "ai_candidate" | "art_photo_item";

export async function hasAcknowledgedAiDisclosure(userId: string) {
  const rows = await (await getDatabase()).query("SELECT 1 FROM ai_disclosure_acknowledgements WHERE user_id=$1 AND policy_version=$2", [userId, AI_DISCLOSURE_POLICY_VERSION]);
  return rows.length > 0;
}

export async function acknowledgeAiDisclosure(userId: string, channel: "miniprogram" | "web" = "miniprogram") {
  await (await getDatabase()).query(
    "INSERT INTO ai_disclosure_acknowledgements (id,user_id,policy_version,channel,acknowledged_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (user_id,policy_version) DO NOTHING",
    [crypto.randomUUID(), userId, AI_DISCLOSURE_POLICY_VERSION, channel],
  );
  return getAiDisclosureStatus(userId);
}

export async function getAiDisclosureStatus(userId: string) {
  return { acknowledged: await hasAcknowledgedAiDisclosure(userId), policyVersion: AI_DISCLOSURE_POLICY_VERSION, text: AI_DISCLOSURE_TEXT };
}

/**
 * 交付生成类原图前调用：没有确认过就拒绝，确认过就记一条交付日志。
 *
 * 错误码固定为 AI_DISCLOSURE_REQUIRED（428），端上据此弹出确认，确认后重试同一请求。
 */
export async function assertAiOriginalDelivery(userId: string, resource: { kind: OriginalDeliveryKind; id: string; storageKey: string }) {
  if (!(await hasAcknowledgedAiDisclosure(userId))) {
    throw new AppError("AI_DISCLOSURE_REQUIRED", AI_DISCLOSURE_TEXT, 428);
  }
  await (await getDatabase()).query(
    "INSERT INTO ai_original_deliveries (id,user_id,resource_kind,resource_id,storage_key,policy_version,delivered_at) VALUES ($1,$2,$3,$4,$5,$6,now())",
    [crypto.randomUUID(), userId, resource.kind, resource.id, resource.storageKey, AI_DISCLOSURE_POLICY_VERSION],
  );
}
