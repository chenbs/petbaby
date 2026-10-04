-- 2026-10：写真扩到 36 套，「全部」套餐改为 36 套（SKU pet-art-photo-bundle-36）。
--
-- 0035 的内联 CHECK 只允许 10 / 24。历史 24 套批次仍要读得出，所以放宽为 10 / 24 / 36，不改写存量。
ALTER TABLE art_photo_batches DROP CONSTRAINT IF EXISTS art_photo_batches_total_count_check;
ALTER TABLE art_photo_batches ADD CONSTRAINT art_photo_batches_total_count_check CHECK (total_count IN (10,24,36));
