CREATE TABLE IF NOT EXISTS verification_checks (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id),
  scope text NOT NULL CHECK (scope IN ('business', 'representative', 'delivery')),
  status text NOT NULL CHECK (status IN ('pending', 'action_required', 'verified', 'rejected', 'expired')),
  actor_id text REFERENCES "user"(id),
  provider text NOT NULL,
  provider_reference text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_company_idx ON verification_checks (company_id, created_at DESC);
