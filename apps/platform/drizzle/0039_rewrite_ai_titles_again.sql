-- 2026-10：再次清理作品标题里的「AI 肖像」。
--
-- 0036 已改写过一次，但旧版代码在迁移之后、新代码上线之前仍可能写入「<宠物名>的AI 肖像」。
-- 这里重复同一条幂等改写；新代码的标题取「宠物名 + 模板名」，不会再产生这类标题。
UPDATE works SET title = regexp_replace(title, 'AI 肖像$', '创意照片')
  WHERE source_kind = 'ai' AND title LIKE '%AI 肖像';
UPDATE work_versions SET title = regexp_replace(title, 'AI 肖像$', '创意照片')
  WHERE title LIKE '%AI 肖像';
