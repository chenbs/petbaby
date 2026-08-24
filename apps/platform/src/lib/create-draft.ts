"use client";

export type CreateDraft = {
  pluginId: string;
  petId: string;
  existingPhotoIds: string[];
  files: File[];
  options: Record<string, string>;
};

const DB_NAME = "petbaby-create-drafts";
const STORE_NAME = "drafts";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export function saveCreateDraft(draft: CreateDraft) {
  return transact("readwrite", (store) => store.put(draft, draft.pluginId));
}

export function loadCreateDraft(pluginId: string) {
  return transact<CreateDraft | undefined>("readonly", (store) => store.get(pluginId));
}

export function clearCreateDraft(pluginId: string) {
  return transact("readwrite", (store) => store.delete(pluginId));
}

export async function compressImage(file: File) {
  if (file.size <= 1_200_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified });
}
