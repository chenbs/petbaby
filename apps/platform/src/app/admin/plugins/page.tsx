import Link from "next/link";

import { PluginEditor } from "@/components/admin/plugin-editor";
import { Badge, Card, cn, PageHeader, StatusBadge } from "@/components/admin/ui";
import { listRuntimePlugins, listRuntimePluginVersions } from "@/plugins/runtime";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "玩法配置" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const CATEGORY_LABELS: Record<string, string> = { layout: "排版", ai: "AI 图片", video: "视频", memorial: "纪念", interactive: "互动" };

export default async function PluginsPage({ searchParams }: Props) {
  await requireAdminPage("/admin/plugins");
  const raw = (await searchParams).id;
  const plugins = await listRuntimePlugins();
  const selectedId = (Array.isArray(raw) ? raw[0] : raw) || plugins[0]?.id;
  const selected = plugins.find((plugin) => plugin.id === selectedId) || plugins[0];
  const versions = (selected ? await listRuntimePluginVersions(selected.id) : []) as Array<Record<string, unknown>>;

  return (
    <>
      <PageHeader title="玩法配置" description="玩法是数据驱动的 manifest：名称、定价、输入要求、样片与生成器模板。图片模板货架在代码登记表里维护，不在这里。" />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="self-start p-2">
          <nav aria-label="玩法列表">
            <ul className="space-y-0.5">
              {plugins.map((plugin) => (
                <li key={plugin.id}>
                  <Link href={`/admin/plugins?id=${encodeURIComponent(plugin.id)}`} aria-current={plugin.id === selected?.id ? "page" : undefined} className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm", plugin.id === selected?.id ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60 hover:text-ink")}>
                    <span className="min-w-0"><span className="block truncate font-medium">{plugin.name}</span><span className="block text-[11px] text-muted">{plugin.code} · {CATEGORY_LABELS[plugin.category] || plugin.category}</span></span>
                    {plugin.status === "live" ? <Badge tone="good" dot={false}>上线</Badge> : <StatusBadge status={plugin.status} />}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Card>
        {selected ? (
          <div>
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-semibold text-ink">{selected.name}</h2>
              <span className="text-sm text-muted">{selected.tagline}</span>
            </div>
            <PluginEditor
              key={`${selected.id}-${versions[0]?.version ?? 0}`}
              pluginId={selected.id}
              manifest={JSON.stringify(selected, null, 2)}
              versions={versions.map((version) => ({ id: String(version.id), version: Number(version.version), template_version: String(version.template_version), created_at: String(version.created_at instanceof Date ? version.created_at.toISOString() : version.created_at) }))}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
