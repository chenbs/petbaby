ALTER TABLE entitlement_ledger ADD COLUMN IF NOT EXISTS resource_id uuid;
ALTER TABLE health_documents ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE INDEX IF NOT EXISTS entitlement_delivery_resource_idx ON entitlement_ledger(resource_id);
