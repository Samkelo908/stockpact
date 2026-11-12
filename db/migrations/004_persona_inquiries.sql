create table if not exists persona_inquiries (
  company_id text not null references companies(id) on delete cascade,
  scope text not null check (scope in ('business', 'representative', 'delivery')),
  attempt_id text not null unique,
  inquiry_id text unique,
  sandbox boolean not null,
  status text not null,
  event_at timestamptz,
  event_id text,
  primary key (company_id, scope)
);
