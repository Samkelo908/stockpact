CREATE TABLE IF NOT EXISTS request_messages (
  id text PRIMARY KEY,
  request_id text NOT NULL,
  supplier_id text NOT NULL,
  author_company_id text NOT NULL REFERENCES companies(id),
  author_user_id text,
  author_name text NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1500),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (supplier_id, request_id) REFERENCES supplier_invitations(company_id, request_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS request_messages_thread_idx ON request_messages (supplier_id, request_id, created_at DESC, id DESC);

INSERT INTO request_messages (id, request_id, supplier_id, author_company_id, author_name, body, created_at)
SELECT 'legacy-' || md5(invite.id || ':' || item.ordinality), invite.request_id, invite.company_id, invite.company_id,
  coalesce(nullif(supplier.data->>'name', ''), 'Supplier'),
  substring(item.entry->>'title' from char_length('Question sent · ') + 1), (item.entry->>'at')::timestamptz
FROM supplier_invitations AS invite
JOIN companies AS supplier ON supplier.id = invite.company_id
CROSS JOIN LATERAL jsonb_array_elements(coalesce(invite.data->'activity', '[]'::jsonb)) WITH ORDINALITY AS item(entry, ordinality)
WHERE item.entry->>'title' LIKE 'Question sent · %' AND item.entry->>'at' IS NOT NULL
  AND char_length(btrim(substring(item.entry->>'title' from char_length('Question sent · ') + 1))) BETWEEN 1 AND 1500
ON CONFLICT (id) DO NOTHING;
