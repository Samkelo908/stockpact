CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_idx ON session ("userId");
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_idx ON account ("userId");
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS stockpact_control (
  id text PRIMARY KEY, data jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO stockpact_control (id) VALUES ('marketplace') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS companies (
  id text PRIMARY KEY, demo boolean NOT NULL, data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
  user_id text NOT NULL REFERENCES "user"(id), role text NOT NULL,
  UNIQUE(company_id, user_id),
  CHECK(role IN ('owner','purchaser','approver','sales','driver','reviewer'))
);
CREATE INDEX IF NOT EXISTS membership_user_idx ON memberships (user_id);
CREATE TABLE IF NOT EXISTS listings (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
  data jsonb NOT NULL, CHECK ((data->>'available')::integer >= 0)
);
CREATE INDEX IF NOT EXISTS listing_company_idx ON listings (company_id);
CREATE TABLE IF NOT EXISTS purchase_requests (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_company_idx ON purchase_requests (company_id);
CREATE TABLE IF NOT EXISTS supplier_invitations (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
  request_id text NOT NULL REFERENCES purchase_requests(id), data jsonb NOT NULL,
  UNIQUE(company_id, request_id)
);
CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
  request_id text NOT NULL REFERENCES purchase_requests(id),
  listing_id text NOT NULL REFERENCES listings(id), version integer NOT NULL,
  data jsonb NOT NULL, UNIQUE(company_id, request_id, version)
);
CREATE INDEX IF NOT EXISTS quotes_request_idx ON quotes (request_id);
CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
  supplier_id text NOT NULL REFERENCES companies(id),
  request_id text NOT NULL UNIQUE REFERENCES purchase_requests(id),
  quote_id text NOT NULL UNIQUE REFERENCES quotes(id), data jsonb NOT NULL,
  CHECK ((data->>'acceptedQuantity')::integer BETWEEN 0 AND (data->>'quantity')::integer),
  CHECK ((data->>'releasedCents')::bigint + (data->>'refundedCents')::bigint <= (data->>'fundedCents')::bigint)
);
CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (company_id);
CREATE INDEX IF NOT EXISTS orders_supplier_idx ON orders (supplier_id);
CREATE INDEX IF NOT EXISTS orders_driver_idx ON orders ((data->>'driverId'));
CREATE TABLE IF NOT EXISTS inventory_movements (
  id text PRIMARY KEY, listing_id text NOT NULL REFERENCES listings(id),
  order_id text REFERENCES orders(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS qr_authorizations (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id),
  supplier_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS qr_order_active_idx ON qr_authorizations (order_id)
  WHERE data->>'status' = 'active';
CREATE TABLE IF NOT EXISTS settlement_refs (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_company_idx ON notifications (company_id);
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES orders(id),
  company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_company_idx ON reviews (company_id);
CREATE TABLE IF NOT EXISTS disputes (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), data jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dispute_order_open_idx ON disputes (order_id)
  WHERE data->>'status' = 'open';
CREATE TABLE IF NOT EXISTS company_preferences (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS shopping_lists (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY, request_id text NOT NULL REFERENCES purchase_requests(id), data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs ((data->>'status'));
CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS team_invitations (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS action_limits (
  id text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL
);
