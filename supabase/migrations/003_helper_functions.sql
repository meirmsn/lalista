-- Helper functions called by the add-item Edge Function.

-- find_item_by_trgm: pg_trgm similarity search returning best match above threshold.
create or replace function find_item_by_trgm(
  p_query    text,
  p_threshold numeric default 0.85
)
returns table (
  id             uuid,
  name_canonical text,
  similarity     numeric
)
language sql
stable
security invoker
as $$
  select id, name_canonical,
         similarity(name_canonical, p_query)::numeric as similarity
  from items
  where similarity(name_canonical, p_query) >= p_threshold
  order by similarity desc
  limit 1;
$$;

-- find_item_alternatives: returns top-N trigram candidates (for disambiguation UI).
create or replace function find_item_alternatives(
  p_query text,
  p_limit int default 3
)
returns table (
  id             uuid,
  name_canonical text,
  similarity     numeric
)
language sql
stable
security invoker
as $$
  select id, name_canonical,
         similarity(name_canonical, p_query)::numeric as similarity
  from items
  where similarity(name_canonical, p_query) > 0.2
  order by similarity desc
  limit p_limit;
$$;

-- route_item_to_store: time-weighted store routing for a household+item.
-- Weight = 1.0 / (1 + days_since * 0.05)  (recent purchases count more)
-- Returns stores ordered by weighted share, highest first.
create or replace function route_item_to_store(
  p_household_id uuid,
  p_item_id      uuid
)
returns table (
  store_id       uuid,
  store_name     text,
  purchase_count bigint,
  weighted_share numeric
)
language sql
stable
security invoker
as $$
  with weighted as (
    select
      ph.store_id,
      s.name as store_name,
      count(*) as purchase_count,
      sum(
        1.0 / (1 + extract(epoch from (now() - ph.bought_at)) / 86400 * 0.05)
      ) as weighted_score
    from purchase_history ph
    join stores s on s.id = ph.store_id
    where ph.household_id = p_household_id
      and ph.item_id = p_item_id
      and ph.bought_at > now() - interval '6 months'
    group by ph.store_id, s.name
  ),
  total as (
    select sum(weighted_score) as total_score from weighted
  )
  select
    w.store_id,
    w.store_name,
    w.purchase_count,
    case when t.total_score > 0 then (w.weighted_score / t.total_score)::numeric else 0 end as weighted_share
  from weighted w, total t
  order by weighted_share desc;
$$;

grant execute on function find_item_by_trgm(text, numeric) to authenticated, anon;
grant execute on function find_item_alternatives(text, int) to authenticated, anon;
grant execute on function route_item_to_store(uuid, uuid) to authenticated;
