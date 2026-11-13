CREATE TABLE IF NOT EXISTS listing_photos (
  listing_id text PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  version uuid NOT NULL,
  contents bytea NOT NULL CHECK (octet_length(contents) BETWEEN 1 AND 524288)
);
