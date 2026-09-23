-- 只有端上观察事件使用；保存/支付事实仍由业务事务唯一记账。
CREATE UNIQUE INDEX IF NOT EXISTS record_event_session_idx
  ON events(user_id,name,(metadata->>'sessionId'),(coalesce(metadata->>'petId','')),(coalesce(metadata->>'viewType','')))
  WHERE name IN ('record_entry_opened','memory_viewed');
