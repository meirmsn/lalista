-- lalista v0 — Initial Schema
-- Run via: supabase db push

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- households: a family unit. Each household has one shared list.
create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- household_members: maps Supabase auth users to households.
create table if not exists household_members (
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner', 'member')) default 'member',
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- stores: known grocery stores.
create table if not exists stores (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  online_cart_supported boolean not null default false,
  created_at            timestamptz not null default now()
);

-- Seed stores (v0 defaults)
insert into stores (name, online_cart_supported) values
  ('Costco',  true),
  ('Walmart', true),
  ('Target',  false)
on conflict (name) do nothing;

-- items: canonical grocery items. pg_trgm indexed for fuzzy search.
create table if not exists items (
  id              uuid primary key default gen_random_uuid(),
  name_canonical  text not null unique,
  category        text,
  created_at      timestamptz not null default now()
);

-- GIN trigram index for fast fuzzy search (used by add-item Edge Function)
create index if not exists items_name_trgm_idx
  on items using gin (name_canonical gin_trgm_ops);

-- list_entries: active pending items for a household.
-- status is always 'pending' — buying moves the row to purchase_history.
create table if not exists list_entries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  item_id      uuid not null references items(id),
  store_id     uuid not null references stores(id),
  brand        text,
  quantity     integer not null default 1,
  unit         text,
  status       text not null check (status = 'pending') default 'pending',
  added_by     uuid not null references auth.users(id),
  added_at     timestamptz not null default now()
);

-- Index for real-time subscription filtering and RLS checks
create index if not exists list_entries_household_idx
  on list_entries (household_id);

-- purchase_history: confirmed purchases only.
-- Written atomically by mark_item_bought() — never directly by the client.
create table if not exists purchase_history (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  item_id      uuid not null references items(id),
  store_id     uuid not null references stores(id),
  brand        text,
  bought_at    timestamptz not null default now(),
  added_by     uuid not null references auth.users(id)
);

-- Composite index for time-weighted store routing query
create index if not exists purchase_history_routing_idx
  on purchase_history (household_id, item_id, store_id, bought_at desc);

-- brand_preferences: learned brand per item/store.
create table if not exists brand_preferences (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  item_id         uuid not null references items(id),
  store_id        uuid not null references stores(id),
  preferred_brand text not null,
  updated_at      timestamptz not null default now(),
  unique (household_id, item_id, store_id)
);

-- config: runtime-tunable thresholds. No app or server deploy needed to change.
create table if not exists config (
  key    text primary key,
  value  text not null
);

-- Seed default thresholds
insert into config (key, value) values
  ('item_match_threshold',    '0.85'),
  ('store_routing_threshold', '0.70')
on conflict (key) do nothing;

-- disambiguation_log: every add-item decision is recorded for threshold tuning.
create table if not exists disambiguation_log (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references households(id) on delete cascade,
  utterance        text not null,
  candidate_item_id uuid references items(id),
  chosen_item_id   uuid references items(id),
  confidence_score numeric(4,3),
  store_id         uuid references stores(id),
  decision_type    text not null check (
    decision_type in ('silent_match', 'asked_item', 'asked_store', 'asked_brand', 'cold_start')
  ),
  created_at       timestamptz not null default now()
);

create index if not exists disambiguation_log_household_idx
  on disambiguation_log (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- Helper: returns the household_id for the current auth user (first match).
-- Used in RLS policies to avoid repeated subqueries.
create or replace function current_household_id()
returns uuid
language sql
stable
security invoker
as $$
  select household_id from household_members
  where user_id = auth.uid()
  limit 1;
$$;

-- Enable RLS on all user-data tables
alter table households           enable row level security;
alter table household_members    enable row level security;
alter table list_entries         enable row level security;
alter table purchase_history     enable row level security;
alter table brand_preferences    enable row level security;
alter table disambiguation_log   enable row level security;

-- households: visible to members
create policy "households_select" on households
  for select using (
    id in (select household_id from household_members where user_id = auth.uid())
  );
create policy "households_insert" on households
  for insert with check (true); -- creator inserts then adds themselves as owner

-- household_members: visible to members of the same household
create policy "household_members_select" on household_members
  for select using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );
create policy "household_members_insert" on household_members
  for insert with check (user_id = auth.uid()); -- user adds themselves

-- list_entries: household members can read/write
create policy "list_entries_select" on list_entries
  for select using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );
create policy "list_entries_insert" on list_entries
  for insert with check (
    household_id in (select household_id from household_members where user_id = auth.uid())
    and added_by = auth.uid()
  );
create policy "list_entries_delete" on list_entries
  for delete using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );

-- purchase_history: readable by household members, written only by mark_item_bought RPC
create policy "purchase_history_select" on purchase_history
  for select using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );

-- brand_preferences: household members can read/write
create policy "brand_preferences_select" on brand_preferences
  for select using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );
create policy "brand_preferences_upsert" on brand_preferences
  for insert with check (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );
create policy "brand_preferences_update" on brand_preferences
  for update using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );

-- disambiguation_log: household members can insert/read
create policy "disambiguation_log_select" on disambiguation_log
  for select using (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );
create policy "disambiguation_log_insert" on disambiguation_log
  for insert with check (
    household_id in (select household_id from household_members where user_id = auth.uid())
  );

-- stores and items are public (read-only for authed users)
alter table stores enable row level security;
alter table items  enable row level security;
alter table config enable row level security;

create policy "stores_select" on stores for select using (auth.uid() is not null);
create policy "items_select"  on items  for select using (auth.uid() is not null);
create policy "config_select" on config for select using (auth.uid() is not null);
