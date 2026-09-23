-- Read-only, user-level attribution. Use the same cohort window for comparisons.
-- 24 hours from first entry to save; seven complete days for revisit/conversion.
-- Natural days use Asia/Shanghai, never a photo's backdated memory_date.
WITH
entry_users AS (
  SELECT user_id,min(created_at) entered_at FROM events
  WHERE name='record_entry_opened' GROUP BY user_id
), saves AS (
  SELECT user_id,created_at,metadata->>'photoId' photo_id FROM events
  WHERE name='upload_completed' AND metadata->>'photoId' IS NOT NULL
), first_records AS (
  SELECT e.user_id,e.entered_at,min(s.created_at) first_saved_at
  FROM entry_users e LEFT JOIN saves s ON s.user_id=e.user_id
    AND s.created_at>=e.entered_at AND s.created_at<e.entered_at+interval '24 hours'
  GROUP BY e.user_id,e.entered_at
), mature AS (
  SELECT * FROM first_records WHERE first_saved_at<=now()-interval '7 days'
), observations AS (
  SELECT m.*,
    EXISTS(SELECT 1 FROM saves s WHERE s.user_id=m.user_id
      AND s.created_at<m.first_saved_at+interval '7 days'
      AND (s.created_at AT TIME ZONE 'Asia/Shanghai')::date>(m.first_saved_at AT TIME ZONE 'Asia/Shanghai')::date) returned_to_save,
    EXISTS(SELECT 1 FROM events e WHERE e.user_id=m.user_id AND e.name='memory_viewed'
      AND e.created_at>m.first_saved_at AND e.created_at<m.first_saved_at+interval '7 days') viewed_memory,
    EXISTS(SELECT 1 FROM events click JOIN works w ON w.user_id=click.user_id
      AND w.pet_id::text=click.metadata->>'petId' AND w.plugin_id=click.metadata->>'productId'
      JOIN orders o ON o.work_id=w.id AND o.user_id=click.user_id
      WHERE click.user_id=m.user_id AND click.name='record_deliverable_opened'
      AND click.created_at>=m.entered_at AND click.created_at<m.first_saved_at+interval '7 days'
      AND o.status='paid' AND o.paid_at>=click.created_at AND o.paid_at<m.first_saved_at+interval '7 days') paid_deliverable
  FROM mature m
)
SELECT
  (SELECT count(*) FROM entry_users) entered_users,
  (SELECT count(*) FROM first_records WHERE first_saved_at IS NOT NULL) saved_within_24h_users,
  (SELECT count(*) FROM first_records WHERE entered_at<=now()-interval '24 hours') mature_entry_users,
  (SELECT count(*) FROM first_records WHERE entered_at<=now()-interval '24 hours' AND first_saved_at IS NOT NULL) mature_entry_saved_users,
  count(*) seven_day_users,
  count(*) FILTER (WHERE returned_to_save) returned_to_save_users,
  count(*) FILTER (WHERE viewed_memory) viewed_memory_users,
  count(*) FILTER (WHERE paid_deliverable) paid_deliverable_users
FROM observations;

-- Record products currently offer paid tier discounts, not consumable credits.
-- Consumable annual-report / health credits remain a separate ledger metric;
-- do not call their usage a record-product conversion without a linked entry.
SELECT kind,count(DISTINCT id) consumed_credits,count(DISTINCT user_id) consumers
FROM entitlement_ledger WHERE status='consumed' GROUP BY kind ORDER BY kind;
