CREATE INDEX IF NOT EXISTS purchase_requests_group_idx ON purchase_requests (company_id, (data->'group'->>'id'))
  WHERE data ? 'group';
