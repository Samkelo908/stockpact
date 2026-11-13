CREATE TABLE IF NOT EXISTS xrpl_mandates (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES companies(id),
  supplier_id text NOT NULL REFERENCES companies(id),
  recipient text NOT NULL,
  destination_tag bigint CHECK (destination_tag BETWEEN 0 AND 4294967295),
  max_drops bigint NOT NULL CHECK (max_drops > 0),
  total_drops bigint NOT NULL CHECK (total_drops >= max_drops),
  used_drops bigint NOT NULL DEFAULT 0 CHECK (used_drops >= 0),
  reserved_drops bigint NOT NULL DEFAULT 0 CHECK (reserved_drops >= 0),
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, supplier_id),
  CHECK (buyer_id <> supplier_id),
  CHECK (used_drops + reserved_drops <= total_drops)
);

CREATE TABLE IF NOT EXISTS xrpl_payment_attempts (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_id text NOT NULL UNIQUE REFERENCES qr_authorizations(id) ON DELETE CASCADE,
  mandate_id text NOT NULL REFERENCES xrpl_mandates(id) ON DELETE CASCADE,
  buyer_id text NOT NULL REFERENCES companies(id),
  supplier_id text NOT NULL REFERENCES companies(id),
  recipient text NOT NULL,
  destination_tag bigint CHECK (destination_tag BETWEEN 0 AND 4294967295),
  amount_drops bigint NOT NULL CHECK (amount_drops > 0),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('queued','processing','pending','confirmed','failed','expired','blocked')),
  reason text,
  agent_approved boolean,
  agent_reason text,
  signer_account text,
  hold_drops bigint NOT NULL DEFAULT 0 CHECK (hold_drops IN (0, amount_drops)),
  tx_hash text UNIQUE,
  signed jsonb,
  ledger_index bigint,
  submitted_at timestamptz,
  lease_id text,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> supplier_id),
  CHECK ((signed IS NULL) = (tx_hash IS NULL)),
  CHECK (status NOT IN ('pending','confirmed','failed','expired') OR signed IS NOT NULL),
  CHECK (status NOT IN ('pending','confirmed','failed','expired') OR submitted_at IS NOT NULL),
  CHECK (status IN ('processing','pending') OR hold_drops = 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS xrpl_signer_active ON xrpl_payment_attempts (signer_account)
  WHERE signer_account IS NOT NULL AND status IN ('processing','pending');
CREATE INDEX IF NOT EXISTS xrpl_attempt_jobs_idx ON xrpl_payment_attempts (next_attempt_at, created_at)
  WHERE status IN ('queued','processing','pending');
CREATE INDEX IF NOT EXISTS xrpl_attempt_company_idx ON xrpl_payment_attempts (buyer_id, supplier_id, created_at DESC);
