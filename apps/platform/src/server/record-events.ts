import "server-only";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

const entry = z.enum(["index", "me", "pets", "photos", "timeline", "create", "web"]);
const id = z.string().uuid();
const observed = z.discriminatedUnion("name", [
  z.object({ name: z.literal("record_entry_opened"), metadata: z.object({ sessionId: id, entry, petId: id.optional() }).strict() }),
  z.object({ name: z.literal("memory_viewed"), metadata: z.object({ sessionId: id, petId: id, viewType: z.enum(["timeline", "detail"]) }).strict() }),
  z.object({ name: z.literal("record_deliverable_opened"), metadata: z.object({ petId: id, productId: z.enum(["pl-23", "pet-time-album", "pl-19"]), entry }).strict() }),
  z.object({ name: z.enum(["visited", "plugin_selected", "previewed"]), metadata: z.object({}).strict() }),
]);
const envelope = z.object({ name: z.string(), pluginId: z.string().max(80).optional(), channel: z.enum(["web", "miniprogram"]).optional(), metadata: z.record(z.string(), z.unknown()).default({}) }).strict();

export async function recordClientEvent(userId: string, input: unknown) {
  const payload = envelope.parse(input);
  const event = observed.parse(payload);
  const metadata = event.metadata as Record<string, unknown>;
  const db = await getDatabase();
  if (metadata.petId) {
    const [pet] = await db.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [metadata.petId, userId]);
    if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  }
  const rows = await db.query("INSERT INTO events (id,user_id,name,plugin_id,channel,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,now()) ON CONFLICT DO NOTHING RETURNING id", [crypto.randomUUID(), userId, event.name, payload.pluginId || null, payload.channel || null, JSON.stringify(metadata)]);
  return { accepted: true, duplicate: !rows.length };
}
