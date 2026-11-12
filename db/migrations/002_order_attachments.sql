create table if not exists order_attachments (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  uploader_id text not null,
  name text not null,
  mime_type text not null,
  size integer not null check (size > 0 and size <= 8388608),
  storage text not null check (storage in ('local', 'r2')),
  created_at timestamptz not null default now()
);

create index if not exists order_attachments_order_idx
  on order_attachments(order_id, created_at desc);
