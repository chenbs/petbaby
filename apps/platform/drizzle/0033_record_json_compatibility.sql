-- Older postgres.js writes encoded JSON text a second time. Restore only
-- structured task/media inputs so jsonb containment can protect old photos.
-- File keys, dates, prices and the decoded values are preserved.
CREATE OR REPLACE FUNCTION pg_temp.record_structured_json(value jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE decoded jsonb;
BEGIN
  IF jsonb_typeof(value) <> 'string' THEN RETURN value; END IF;
  BEGIN decoded := (value #>> '{}')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RETURN value;
  END;
  IF jsonb_typeof(decoded) IN ('object','array') THEN RETURN decoded; END IF;
  RETURN value;
END;
$$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND data_type='jsonb' AND
      (table_name,column_name) IN (
        ('photos','tags'),
        ('generation_tasks','photo_ids'),('generation_tasks','options'),('generation_tasks','plugin_snapshot'),
        ('ai_runs','photo_ids'),('ai_runs','options'),('ai_runs','role_inputs'),('ai_runs','candidates'),
        ('video_renders','config'),
        ('video_projects','photo_ids'),('video_projects','captions'),('video_projects','durations'),('video_projects','transitions'),('video_projects','draft_snapshot'),
        ('interactive_sessions','photo_ids'),('interactive_sessions','snapshot'),
        ('memorial_spaces','photo_ids')
      )
  LOOP
    EXECUTE format('UPDATE %I SET %I=pg_temp.record_structured_json(%I) WHERE jsonb_typeof(%I)=''string''', item.table_name,item.column_name,item.column_name,item.column_name);
  END LOOP;
END;
$$;
DROP FUNCTION pg_temp.record_structured_json(jsonb);
