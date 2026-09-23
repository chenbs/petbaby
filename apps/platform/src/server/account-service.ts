import "server-only";

import { z } from "zod";
import type { AccountProfile } from "@/domain/models";
import { getDatabase, inTransaction } from "@/server/db/client";
import { processObjectCleanupJob, queueObjectCleanup } from "@/server/object-cleanup";
import { AppError } from "@/server/errors";
import { softDeletePetResources } from "@/server/photo-deletion-service";

export async function getAccountProfile(userId: string): Promise<AccountProfile> {
  const database = await getDatabase();
  const rows = await database.query("SELECT id,display_name,created_at,deleted_at FROM users WHERE id=$1", [userId]);
  if (!rows[0] || rows[0].deleted_at) throw new AppError("ACCOUNT_NOT_FOUND", "账户不存在", 404);
  return { id: String(rows[0].id), displayName: rows[0].display_name ? String(rows[0].display_name) : undefined, createdAt: new Date(String(rows[0].created_at)).toISOString() };
}

export async function updateAccountProfile(userId: string, input: unknown) {
  const data = z.object({ displayName: z.string().trim().min(1).max(40) }).parse(input);
  await getAccountProfile(userId);
  const database = await getDatabase();
  const rows = await database.query("UPDATE users SET display_name=$2 WHERE id=$1 RETURNING id,display_name,created_at", [userId, data.displayName]);
  return { id: String(rows[0].id), displayName: rows[0].display_name ? String(rows[0].display_name) : undefined, createdAt: new Date(String(rows[0].created_at)).toISOString() };
}

export async function exportAccountData(userId: string) {
  await getAccountProfile(userId);
  const database = await getDatabase();
  const [user, pets, photos, ownerPhotos, works, orders, events] = await Promise.all([
    database.query("SELECT id,display_name,created_at FROM users WHERE id=$1", [userId]),
    database.query("SELECT id,name,species,gender,birthday,is_default,created_at FROM pets WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at", [userId]),
    database.query("SELECT id,pet_id,filename,mime_type,size,position,quality,created_at FROM photos WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at", [userId]),
    database.query("SELECT id,filename,mime_type,size,quality,authorization_confirmed_at,created_at FROM owner_photos WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at", [userId]),
    database.query("SELECT id,plugin_id,pet_id,title,subtitle,locked,public,version,created_at FROM works WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at", [userId]),
    database.query("SELECT id,work_id,plugin_id,amount,status,created_at,paid_at,refunded_amount FROM orders WHERE user_id=$1 ORDER BY created_at", [userId]),
    database.query("SELECT id,plugin_id,name,created_at FROM events WHERE user_id=$1 ORDER BY created_at", [userId]),
  ]);
  return { exportedAt: new Date().toISOString(), user: user[0], pets, photos, ownerPhotos, works, orders, events };
}

export async function deleteAccount(userId: string) {
  await getAccountProfile(userId);
  const jobs = await inTransaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const pets = await db.query("SELECT id FROM pets WHERE user_id=$1 AND deleted_at IS NULL ORDER BY id FOR UPDATE", [userId]);
    const ids: string[] = [];
    for (const pet of pets) ids.push(...await softDeletePetResources(userId, String(pet.id)));
    const owners = await db.query("UPDATE owner_photos SET deleted_at=coalesce(deleted_at,now()) WHERE user_id=$1 RETURNING storage_key", [userId]);
    for (const photo of owners) ids.push(await queueObjectCleanup(String(photo.storage_key), "account_deleted"));
    await db.query("UPDATE users SET deleted_at=now(),display_name=NULL,wechat_openid=NULL WHERE id=$1", [userId]);
    return ids;
  });
  for (const job of jobs) await processObjectCleanupJob(job);
  const database = await getDatabase();
  // user_id 是 uuid、target_id 是 text，复用同一个占位符会让 PostgreSQL 推断出冲突类型。
  await database.query("INSERT INTO audit_logs (id,user_id,action,target_type,target_id,created_at) VALUES ($1,$2,'account_deleted','user',$3,$4)", [crypto.randomUUID(), userId, userId, new Date()]);
  return { deleted: true };
}
