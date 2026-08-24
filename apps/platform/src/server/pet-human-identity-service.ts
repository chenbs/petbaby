import "server-only";

import sharp from "sharp";

import type { ImageReference } from "@/server/ai/provider";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

export const PET_HUMAN_IDENTITY_PROMPT_VERSION = "pet-human-identity-v1";

export type PetHumanIdentity = {
  id: string;
  userId: string;
  petId: string;
  sourcePhotoId: string;
  promptVersion: string;
  storageKey: string;
  status: "generating" | "ready" | "failed";
  provider?: string;
  modelVersion?: string;
  errorCode?: string;
  updatedAt: string;
};

function mapIdentity(row: Record<string, unknown>): PetHumanIdentity {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    petId: String(row.pet_id),
    sourcePhotoId: String(row.source_photo_id),
    promptVersion: String(row.prompt_version),
    storageKey: String(row.storage_key),
    status: (row.status || "generating") as PetHumanIdentity["status"],
    provider: row.provider ? String(row.provider) : undefined,
    modelVersion: row.model_version ? String(row.model_version) : undefined,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function buildPetHumanIdentityPrompt() {
  return [
    "Create a private reusable human identity card for one specific pet.",
    "The pet photo is the only identity source: preserve this individual pet's eyes, eye spacing, face width, muzzle-to-face proportion, markings, color relationships and observed expression as a natural human translation.",
    "Return one complete, credible adult human portrait on a neutral grey background, with a clear face and shoulders and a plain fully covering crew-neck top, suitable as an identity reference for later image edits.",
    "Translate animal traits into human visual language rather than copying animal organs: no animal ears, animal nose, animal mouth, fur face, feathers, tail, paws, claws, muzzle or hybrid anatomy.",
    "Do not copy a generic influencer face, do not beautify away the pet's distinctive proportions, do not make the person a child, and do not add decorative costume, exposed clothing, text, logos, watermarks or extra subjects.",
    "The result must look like this exact pet if it had always been human, not a random human with a pet color filter.",
    "Return exactly 720x1280 portrait PNG content.",
  ].join(" ");
}

export async function findPetHumanIdentity(userId: string, petId: string, sourcePhotoId: string, promptVersion = PET_HUMAN_IDENTITY_PROMPT_VERSION) {
  const rows = await (await getDatabase()).query(
    "SELECT * FROM pet_human_identities WHERE user_id=$1 AND pet_id=$2 AND source_photo_id=$3 AND prompt_version=$4",
    [userId, petId, sourcePhotoId, promptVersion],
  );
  return rows[0] ? mapIdentity(rows[0]) : undefined;
}

/** Claim one cache key. A ready row is reusable; a generating row belongs to another worker. */
export async function claimPetHumanIdentity(userId: string, petId: string, sourcePhotoId: string, storageKey: string, promptVersion = PET_HUMAN_IDENTITY_PROMPT_VERSION) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date();
  const inserted = await database.query(
    "INSERT INTO pet_human_identities (id,user_id,pet_id,source_photo_id,prompt_version,storage_key,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'generating',$7,$7) ON CONFLICT (user_id,pet_id,source_photo_id,prompt_version) DO NOTHING RETURNING *",
    [id, userId, petId, sourcePhotoId, promptVersion, storageKey, now],
  );
  if (inserted[0]) return { owner: true, identity: mapIdentity(inserted[0]) };
  const existing = await findPetHumanIdentity(userId, petId, sourcePhotoId, promptVersion);
  if (!existing) throw new Error("PET_HUMAN_IDENTITY_CLAIM_LOST");
  const stale = existing.status === "generating" && new Date(existing.updatedAt).getTime() < Date.now() - 10 * 60_000;
  if (existing.status === "failed" || stale) {
    const retried = await database.query(
      "UPDATE pet_human_identities SET status='generating',error_code=NULL,storage_key=$5,updated_at=$6 WHERE user_id=$1 AND pet_id=$2 AND source_photo_id=$3 AND prompt_version=$4 AND (status='failed' OR updated_at < now() - interval '10 minutes') RETURNING *",
      [userId, petId, sourcePhotoId, promptVersion, storageKey, now],
    );
    if (retried[0]) return { owner: true, identity: mapIdentity(retried[0]) };
  }
  return { owner: false, identity: existing };
}

export async function waitForPetHumanIdentity(userId: string, petId: string, sourcePhotoId: string, promptVersion = PET_HUMAN_IDENTITY_PROMPT_VERSION) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const identity = await findPetHumanIdentity(userId, petId, sourcePhotoId, promptVersion);
    if (!identity || identity.status !== "generating") return identity;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return findPetHumanIdentity(userId, petId, sourcePhotoId, promptVersion);
}

export async function markPetHumanIdentityReady(id: string, provider: string, modelVersion: string) {
  const rows = await (await getDatabase()).query(
    "UPDATE pet_human_identities SET status='ready',provider=$2,model_version=$3,error_code=NULL,updated_at=now() WHERE id=$1 RETURNING *",
    [id, provider, modelVersion],
  );
  return rows[0] ? mapIdentity(rows[0]) : undefined;
}

export async function markPetHumanIdentityFailed(id: string, errorCode: string) {
  const rows = await (await getDatabase()).query(
    "UPDATE pet_human_identities SET status='failed',error_code=$2,updated_at=now() WHERE id=$1 RETURNING *",
    [id, errorCode.slice(0, 200)],
  );
  return rows[0] ? mapIdentity(rows[0]) : undefined;
}

function storageKeyFor(userId: string, petId: string, sourcePhotoId: string, promptVersion: string) {
  const safeVersion = promptVersion.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `private/${userId}/pet-human/${petId}-${sourcePhotoId}-${safeVersion}.png`;
}

async function loadReadyReference(identity: PetHumanIdentity): Promise<ImageReference | undefined> {
  if (!identity.storageKey.startsWith(`private/${identity.userId}/pet-human/`)) return undefined;
  const object = await objectStorage.get(identity.storageKey).catch(() => null);
  if (!object || !object.body.byteLength || !object.contentType.startsWith("image/")) return undefined;
  return { body: object.body, contentType: object.contentType, filename: "pet-human-identity.png" };
}

export async function ensurePetHumanIdentity(input: {
  userId: string;
  petId: string;
  sourcePhotoId: string;
  promptVersion?: string;
  generate: () => Promise<{ body: Uint8Array; provider: string; modelVersion: string }>;
}) {
  const promptVersion = input.promptVersion || PET_HUMAN_IDENTITY_PROMPT_VERSION;
  const storageKey = storageKeyFor(input.userId, input.petId, input.sourcePhotoId, promptVersion);
  const current = await findPetHumanIdentity(input.userId, input.petId, input.sourcePhotoId, promptVersion);
  if (current?.status === "ready") {
    const reference = await loadReadyReference(current);
    if (reference) return { identity: current, reference, generated: false };
    await markPetHumanIdentityFailed(current.id, "PET_HUMAN_IDENTITY_OBJECT_MISSING");
  }

  const claim = await claimPetHumanIdentity(input.userId, input.petId, input.sourcePhotoId, storageKey, promptVersion);
  if (!claim.owner) {
    const settled = await waitForPetHumanIdentity(input.userId, input.petId, input.sourcePhotoId, promptVersion);
    if (settled?.status === "ready") {
      const reference = await loadReadyReference(settled);
      if (reference) return { identity: settled, reference, generated: false };
    }
    throw new AppError("PET_HUMAN_IDENTITY_PENDING", "宠物人形身份仍在生成，请稍后重试", 409);
  }

  try {
    const generated = await input.generate();
    const png = new Uint8Array(await sharp(Buffer.from(generated.body))
      .resize(720, 1280, { fit: "cover" })
      .png()
      .toBuffer());
    await objectStorage.put(storageKey, png, "image/png");
    const ready = await markPetHumanIdentityReady(claim.identity.id, generated.provider, generated.modelVersion);
    if (!ready) throw new Error("PET_HUMAN_IDENTITY_READY_UPDATE_FAILED");
    return {
      identity: ready,
      reference: { body: png, contentType: "image/png", filename: "pet-human-identity.png" } satisfies ImageReference,
      generated: true,
    };
  } catch (error) {
    await objectStorage.delete(storageKey).catch(() => undefined);
    await markPetHumanIdentityFailed(claim.identity.id, error instanceof Error ? error.message : "PET_HUMAN_IDENTITY_FAILED");
    throw error;
  }
}

export async function deletePetHumanIdentities(where: { userId?: string; petId?: string; sourcePhotoId?: string }) {
  const clauses: string[] = [];
  const values: string[] = [];
  for (const [column, value] of [["user_id", where.userId], ["pet_id", where.petId], ["source_photo_id", where.sourcePhotoId]] as const) {
    if (value) { values.push(value); clauses.push(`${column}=$${values.length}`); }
  }
  if (!clauses.length) throw new Error("PET_HUMAN_IDENTITY_DELETE_FILTER_REQUIRED");
  const database = await getDatabase();
  const rows = await database.query<{ storage_key: string }>(`DELETE FROM pet_human_identities WHERE ${clauses.join(" AND ")} RETURNING storage_key`, values);
  await Promise.all(rows.map((row) => objectStorage.delete(row.storage_key).catch(() => undefined)));
  return { deleted: rows.length };
}
