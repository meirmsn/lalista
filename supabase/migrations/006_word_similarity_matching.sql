-- Three-tier fuzzy matching for find_item_by_trgm and find_item_alternatives.
--
-- Tier 1 — trigram + word_similarity (pg_trgm)
--   Best for: typos, transpositions, misspellings ("plamito", "palmyto")
--   Not great for: plurals or suffix variations ("palmitos" scores ~0.60)
--
-- Tier 2 — exact substring (LIKE)
--   Best for: plurals, prefixes, partial words ("palmitos", "leche", "ziplocs")
--   Requires min 4 chars to avoid noise. Fixed score of 0.75 (below default
--   threshold) so it always triggers disambiguation when multiple items match.
--
-- Tier 3 — Levenshtein edit distance, word-by-word (fuzzystrmatch)
--   Best for: typos on multi-word items missed by trigrams ("mozarella" → "Mozzarella rallado")
--   Compares query against each word in name_canonical. Max 2 edits, min 5 chars.
--   Fixed score of 0.70 (below tier 2) so it also routes through disambiguation.

create extension if not exists fuzzystrmatch;

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
  with tier1 as (
    select id, name_canonical,
           greatest(
             similarity(name_canonical, p_query),
             word_similarity(p_query, name_canonical)
           )::numeric as score
    from items
    where similarity(name_canonical, p_query) >= p_threshold
       or word_similarity(p_query, name_canonical) >= (p_threshold * 0.9)
  ),
  tier2 as (
    select id, name_canonical, 0.75::numeric as score
    from items
    where length(p_query) >= 4
      and (
        lower(name_canonical) like '%' || lower(p_query) || '%'
        or lower(p_query)     like '%' || lower(name_canonical) || '%'
        or lower(p_query)     like lower(name_canonical) || '%'
      )
      and id not in (select id from tier1)
  ),
  tier3 as (
    select distinct i.id, i.name_canonical, 0.70::numeric as score
    from items i, unnest(string_to_array(lower(i.name_canonical), ' ')) as word
    where length(p_query) >= 5
      and levenshtein(word, lower(p_query)) <= 2
      and i.id not in (select id from tier1)
      and i.id not in (select id from tier2)
  )
  select id, name_canonical, score as similarity
  from (
    select * from tier1
    union all select * from tier2
    union all select * from tier3
  ) combined
  order by score desc
  limit 1;
$$;

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
  with tier1 as (
    select id, name_canonical,
           greatest(
             similarity(name_canonical, p_query),
             word_similarity(p_query, name_canonical)
           )::numeric as score
    from items
    where greatest(
      similarity(name_canonical, p_query),
      word_similarity(p_query, name_canonical)
    ) > 0.2
  ),
  tier2 as (
    select id, name_canonical, 0.75::numeric as score
    from items
    where length(p_query) >= 4
      and (
        lower(name_canonical) like '%' || lower(p_query) || '%'
        or lower(p_query)     like '%' || lower(name_canonical) || '%'
        or lower(p_query)     like lower(name_canonical) || '%'
      )
      and id not in (select id from tier1)
  ),
  tier3 as (
    select distinct i.id, i.name_canonical, 0.70::numeric as score
    from items i, unnest(string_to_array(lower(i.name_canonical), ' ')) as word
    where length(p_query) >= 5
      and levenshtein(word, lower(p_query)) <= 2
      and i.id not in (select id from tier1)
      and i.id not in (select id from tier2)
  )
  select id, name_canonical, score as similarity
  from (
    select * from tier1
    union all select * from tier2
    union all select * from tier3
  ) combined
  order by score desc
  limit p_limit;
$$;
