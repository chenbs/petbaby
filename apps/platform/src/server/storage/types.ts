import "server-only";

export type StoredObject = {
  body: Uint8Array;
  contentType: string;
};

export type SignedObjectUrl = {
  url: string;
  expiresAt: string;
};

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** 客户端直连下载的预签名地址；本地磁盘存储没有，调用方回落到经服务器下载。 */
  signedUrl?(key: string): SignedObjectUrl;
  exists?(key: string): Promise<boolean>;
}
