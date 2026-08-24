import { notFound } from "next/navigation";

import { CreateFlow } from "@/components/create-flow";
import { getRuntimePlugin } from "@/plugins/runtime";
import { requireUserId } from "@/server/auth/session";
import { recordEvent } from "@/server/platform-service";

export const dynamic = "force-dynamic";

export default async function CreatePage({
  params,
}: {
  params: Promise<{ pluginId: string }>;
}) {
  const { pluginId } = await params;
  const plugin = await getRuntimePlugin(pluginId);
  if (!plugin || plugin.status !== "live") notFound();
  await recordEvent(await requireUserId(), "plugin_selected", plugin.id);
  return <CreateFlow plugin={plugin} />;
}
