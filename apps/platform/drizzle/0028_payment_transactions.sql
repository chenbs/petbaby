CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  order_kind text NOT NULL CHECK (order_kind IN ('work','growth','physical')),
  sku text NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  provider text NOT NULL CHECK (provider IN ('development','virtual','wechat')),
  out_trade_no text NOT NULL UNIQUE,
  openid text,
  product_id text,
  environment integer NOT NULL DEFAULT 0 CHECK (environment IN (0,1)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','closed','refunded')),
  provider_transaction_id text,
  channel text,
  refunded_fen integer NOT NULL DEFAULT 0,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_kind,order_id)
);
CREATE INDEX IF NOT EXISTS payment_reconcile_idx ON payment_transactions(status,checked_at);
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_transaction_idx ON payment_transactions(provider,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
  out_refund_no text NOT NULL UNIQUE,
  provider_refund_id text,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed')),
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_refund_inflight_idx ON payment_refunds(payment_id) WHERE status IN ('pending','processing');
CREATE TABLE IF NOT EXISTS payment_refund_inquiries (
  id uuid PRIMARY KEY,
  payment_id uuid REFERENCES payment_transactions(id) ON DELETE SET NULL,
  request_hash text NOT NULL UNIQUE,
  result_code integer NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wechat_sessions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entitlement_order_payment_idx ON entitlement_ledger(order_id,status);
CREATE INDEX IF NOT EXISTS entitlement_membership_payment_idx ON entitlement_ledger(membership_id,status);
