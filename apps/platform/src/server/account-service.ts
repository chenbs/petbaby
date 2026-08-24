import "server-only";

import { z } from "zod";
import type { AccountProfile } from "@/domain/models";
import { getDatabase } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { AppError } from "@/server/errors";
import { deletePetHumanIdentities } from "@/server/pet-human-identity-service";

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
  const database = await getDatabase();
  await deletePetHumanIdentities({ userId });
  const photoRows = await database.query<{ storage_key: string }>("SELECT storage_key FROM photos WHERE user_id=$1", [userId]);
  const ownerPhotoRows = await database.query<{ storage_key: string }>("SELECT storage_key FROM owner_photos WHERE user_id=$1", [userId]);
  await Promise.all([...photoRows, ...ownerPhotoRows].map((row) => objectStorage.delete(row.storage_key).catch(() => undefined)));
  await database.query("UPDATE pets SET deleted_at=now(),is_default=false WHERE user_id=$1 AND deleted_at IS NULL", [userId]);
  await database.query("UPDATE photos SET deleted_at=now() WHERE user_id=$1 AND deleted_at IS NULL", [userId]);
  await database.query("UPDATE owner_photos SET deleted_at=now() WHERE user_id=$1 AND deleted_at IS NULL", [userId]);
  await database.query("UPDATE works SET deleted_at=now(),public=false,share_token=null WHERE user_id=$1 AND deleted_at IS NULL", [userId]);
  await database.query("UPDATE users SET deleted_at=now(),display_name=NULL,wechat_openid=NULL WHERE id=$1", [userId]);
  // user_id 是 uuid、target_id 是 text，复用同一个占位符会让 PostgreSQL 推断出冲突类型。
  await database.query("INSERT INTO audit_logs (id,user_id,action,target_type,target_id,created_at) VALUES ($1,$2,'account_deleted','user',$3,$4)", [crypto.randomUUID(), userId, userId, new Date()]);
  return { deleted: true };
}
