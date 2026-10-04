-- 2026-09 产品口径调整（方案见 docs/ui-refactor/2026-09-29-产品UIUX评审/）。
--
-- 1. 作品长期保存：未付费作品不再 90 天后硬删除。维护任务已不再按 expires_at 清理，
--    这里把存量作品的到期时间一并清空，避免旧版本 Worker 在滚动发布期间继续删除。
UPDATE works SET expires_at = NULL WHERE expires_at IS NOT NULL;

-- 2. 已入库作品的「AI」字样。只改由系统写死的默认文案，用户改过的标题不动。
UPDATE works SET authority = '麻麻抱我照相馆' WHERE authority = '麻麻抱我 AI 工作室';
UPDATE works SET serial_number = 'MB-' || substring(serial_number FROM 4)
  WHERE source_kind = 'ai' AND serial_number LIKE 'AI-%';
UPDATE works SET subtitle = '从 2 张里挑中的这一张'
  WHERE source_kind = 'ai' AND subtitle LIKE 'AI 生成内容 · 已选中的%';
UPDATE works SET title = regexp_replace(title, 'AI 肖像$', '创意照片')
  WHERE source_kind = 'ai' AND title LIKE '%AI 肖像';
UPDATE work_versions SET subtitle = '从 2 张里挑中的这一张'
  WHERE subtitle LIKE 'AI 生成内容 · 已选中的%';
UPDATE work_versions SET title = regexp_replace(title, 'AI 肖像$', '创意照片')
  WHERE title LIKE '%AI 肖像';

-- 3. 互动星尘页（PL-15）下线。ensurePluginConfigs 的播种是 ON CONFLICT DO NOTHING，
--    只改 registry.ts 不会影响已有 pl-15 行的库，所以在这里把库内 manifest 标为 archived。
--    manifest 不能删：纪念星尘页与历史互动导出作品仍以 plugin_id='pl-15' 读取它。
--    表 interactive_sessions / interactive_events 暂时保留作回退余地，下一个发布周期再删。
UPDATE plugin_configs
  SET manifest = jsonb_set(
        CASE WHEN jsonb_typeof(manifest) = 'string' THEN (manifest #>> '{}')::jsonb ELSE manifest END,
        '{status}', '"archived"'::jsonb
      ),
      updated_at = now()
  WHERE id = 'pl-15';
