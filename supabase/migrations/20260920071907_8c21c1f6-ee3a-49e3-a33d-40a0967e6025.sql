CREATE TABLE IF NOT EXISTS public.betclan_cache (
  pair_key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  tmp_home NUMERIC,
  tmp_away NUMERIC,
  payload JSONB NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.betclan_cache TO service_role;
ALTER TABLE public.betclan_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS betclan_cache_scraped_at_idx ON public.betclan_cache (scraped_at DESC);