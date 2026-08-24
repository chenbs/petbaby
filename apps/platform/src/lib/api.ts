export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Petbaby-Client": "web", ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "请求失败，请稍后再试");
  }
  return payload.data as T;
}

export async function apiUpload<T>(path: string, body: FormData): Promise<T> {
  const response = await fetch(path, { method: "POST", body, headers: { "X-Petbaby-Client": "web" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "上传失败，请稍后再试");
  return payload.data as T;
}

export function apiUploadWithProgress<T>(path: string, body: FormData, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.setRequestHeader("X-Petbaby-Client", "web");
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => { try { const payload = JSON.parse(request.responseText); if (request.status >= 200 && request.status < 300) resolve(payload.data as T); else reject(new Error(payload.error?.message || "上传失败")); } catch { reject(new Error("上传响应无效")); } };
    request.onerror = () => reject(new Error("上传失败，请检查网络"));
    request.onabort = () => reject(new DOMException("上传已取消", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}
