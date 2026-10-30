-- lalista seed data
-- A starter catalog of common grocery items (Spanish/English) and stores.
-- New items are created automatically on cold start — this just pre-populates
-- the catalog so common adds are silent matches from day one.
--
-- NOTE: purchase_history (which drives store routing) is NOT seeded here because
-- it requires a real household_id + user_id. See TODOS.md → bootstrap-purchase-history-prod.

-- ---------------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------------
-- NOTE: migration 016 drops stores_name_key (UNIQUE on stores.name) — Model B
-- intentionally allows N households to mint their own "Trader Joe's" custom row.
-- With the constraint gone, the prior `on conflict (name) do nothing` form
-- raises 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
-- specification") at seed time. We also can't use `on conflict do nothing`
-- without a target — that would let `pnpm db:reset` re-runs accumulate
-- duplicates AND it would collide with the catalog rows migration 001 already
-- inserts (Costco, Walmart, Target). Skip rows whose names already exist:
insert into stores (name, online_cart_supported)
select v.name, v.online_cart_supported
from (values
  ('Walmart',        true),
  ('Costco',         true),
  ('Safeway',        false),
  ('Trader Joe''s',  false),
  ('Target',         true),
  ('Walgreens',      false),
  ('Western Kosher', false),
  ('Whole Foods',    false)
) as v(name, online_cart_supported)
where not exists (select 1 from stores existing where existing.name = v.name);

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
insert into items (name_canonical, category) values
  ('Leche entera',           'dairy'),
  ('Leche 2%',               'dairy'),
  ('Leche lactaid',          'dairy'),
  ('Cottage cheese',         'dairy'),
  ('Mozzarella rallado',     'dairy'),
  ('Mozzarella bolitas',     'dairy'),
  ('Parmesano',              'dairy'),
  ('Queso fresco',           'dairy'),
  ('Brie',                   'dairy'),
  ('Yogurt griego',          'dairy'),
  ('Mantequilla',            'dairy'),
  ('Cream cheese',           'dairy'),
  ('Huevos pasteurizados',   'dairy'),
  ('Yogurt',                 'dairy'),
  ('Banano',                 'produce'),
  ('Plátano',                'produce'),
  ('Aguacate',               'produce'),
  ('Brocoli',                'produce'),
  ('Zanahoria',              'produce'),
  ('Papa',                   'produce'),
  ('Sweet potato',           'produce'),
  ('Pollo',                  'meat'),
  ('Pavo',                   'meat'),
  ('Carne molida',           'meat'),
  ('Espagueti',              'pantry'),
  ('Lentejas',               'pantry'),
  ('Frijoles',               'pantry'),
  ('Frijoles negros',        'pantry'),
  ('Arroz',                  'pantry'),
  ('Avena',                  'pantry'),
  ('Cereal',                 'pantry'),
  ('Olive oil',              'pantry'),
  ('Palmito',                'pantry'),
  ('Sal',                    'pantry'),
  ('Azúcar',                 'pantry'),
  ('Jugo de manzana',        'beverages'),
  ('Agua de coco',           'beverages'),
  ('Fresas congeladas',      'frozen'),
  ('Tilapia',                'frozen'),
  ('Pan',                    'bakery'),
  ('Tortillas',              'bakery'),
  ('Tortillas de maíz',      'bakery'),
  ('Cashews',                'snacks'),
  ('Aceitunas',              'snacks'),
  ('Windex',                 'household'),
  ('Clorox wipes',           'household'),
  ('Kleenex',                'household'),
  ('Bounty',                 'household'),
  ('Pasta de dientes',       'personal care')
;

-- ---------------------------------------------------------------------------
-- Test fixtures (local dev + CI integration tests)
--
-- Creates two households with a user in each, for RLS boundary tests that
-- verify User A's data is invisible to User B. Fixed UUIDs so tests can
-- reference them deterministically. Local-dev only — real users come from
-- Supabase Auth via sign-up.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Why the four `''` columns and the identities insert below:
-- gotrue v2.188+ scans these auth.users text columns into Go `string`
-- (not `*string` / sql.NullString): email_change, recovery_token,
-- confirmation_token, email_change_token_new. Leaving them NULL trips a
-- driver scan error on every read of the row, surfacing as a 500
-- `unexpected_failure: Database error finding users` from
-- /auth/v1/admin/users and /auth/v1/token. gotrue's own signup path inserts
-- '' for these; the seed has to match that shape. Same goes for the matching
-- auth.identities row — gotrue's listUsers + token endpoints expect every
-- user to have at least one identity (provider='email', provider_id=user.id::text).
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  email_change, recovery_token, confirmation_token, email_change_token_new
) values
  (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'alice@test.local',
    crypt('Password123!', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', '11111111-1111-1111-1111-111111111111', 'email', 'alice@test.local', 'email_verified', true, 'phone_verified', false),
    '', '', '', ''
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bob@test.local',
    crypt('Password123!', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('sub', '22222222-2222-2222-2222-222222222222', 'email', 'bob@test.local', 'email_verified', true, 'phone_verified', false),
    '', '', '', ''
  )
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(),
  u.id,
  'email',
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  now(), now(), now()
from auth.users u
where u.email in ('alice@test.local', 'bob@test.local')
  and u.id not in (select user_id from auth.identities)
on conflict do nothing;

insert into households (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Casa Alice'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Casa Bob')
on conflict (id) do nothing;

insert into household_members (household_id, user_id, role) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'owner'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '22222222-2222-2222-2222-222222222222',
    'owner'
  )
on conflict (household_id, user_id) do nothing;

-- Backfill household_stores for seed households.
--
-- Migration 016 ships a cross-join backfill of globals into household_stores
-- (016 step 5). But CLI migration order is `migrations applied → seed run`,
-- so at migration-016 time the households table is empty (Alice + Bob arrive
-- with this seed file). The migration's backfill targets zero rows, and the
-- seed's `list_entries` insert below would trip migration 016's defense-in-
-- depth BEFORE INSERT trigger `list_entries_store_membership_check`
-- (P0001 "store … is not in household …'s My Stores").
--
-- Fix: re-issue the same cross-join for seed-time households here. Mirrors
-- the migration's intent (every household starts with every global). Custom
-- stores (is_global=false) aren't relevant for seed households — none exist
-- at this point.
insert into household_stores (household_id, store_id, added_by)
select h.id, s.id, null
from households h
cross join stores s
where s.is_global = true
on conflict do nothing;

insert into list_entries (id, household_id, item_id, store_id, quantity, status, added_by)
select
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  i.id,
  s.id,
  1,
  'pending',
  '11111111-1111-1111-1111-111111111111'
from items i, stores s
where i.name_canonical = 'Leche entera' and s.name = 'Whole Foods'
on conflict (id) do nothing;

insert into list_entries (id, household_id, item_id, store_id, quantity, status, added_by)
select
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  i.id,
  s.id,
  1,
  'pending',
  '22222222-2222-2222-2222-222222222222'
from items i, stores s
where i.name_canonical = 'Pollo' and s.name = 'Costco'
on conflict (id) do nothing;
