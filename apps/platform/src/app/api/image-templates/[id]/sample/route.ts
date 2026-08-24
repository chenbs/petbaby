import { getImageTemplate } from "@/server/image-template-registry";
import { objectStorage } from "@/server/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const template = getImageTemplate(id);
  if (!template?.sampleStorageKey) return new Response("Not found", { status: 404 });
  const object = await objectStorage.get(template.sampleStorageKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(object.body), {
    headers: { "Content-Type": object.contentType, "Cache-Control": "public, max-age=86400, immutable" },
  });
}
