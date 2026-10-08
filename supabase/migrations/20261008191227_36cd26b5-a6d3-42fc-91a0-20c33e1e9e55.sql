CREATE TABLE public.onexbet_odds (
  event_id text PRIMARY KEY,
  home text NOT NULL,
  away text NOT NULL,
  home_norm text NOT NULL,
  away_norm text NOT NULL,
  league text,
  start_time timestamptz,
  odds jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.onexbet_odds TO service_role;
ALTER TABLE public.onexbet_odds ENABLE ROW LEVEL SECURITY;
CREATE INDEX onexbet_odds_fetched_idx ON public.onexbet_odds (fetched_at DESC);