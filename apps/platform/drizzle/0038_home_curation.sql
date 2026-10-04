-- 麻麻精选配置化（2026-09）。
--
-- 原先精选的 9 个模板 ID、6 套写真场景和主卡文案写死在小程序 services/home-effect-ids.js 与 WXML 里，
-- 「每周换一换」必须发版。这里放一张单行配置表：后台可编辑，端上从 GET /api/home-curation 读取，
-- 读不到时回落到端上内置的默认值，所以这张表为空也不影响首页。
CREATE TABLE IF NOT EXISTS home_curation (
  id text PRIMARY KEY,
  config jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
