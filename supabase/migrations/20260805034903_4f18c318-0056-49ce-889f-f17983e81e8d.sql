CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.daily_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date DATE NOT NULL,
  match_id TEXT NOT NULL,
  league_name TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_logo TEXT,
  away_logo TEXT,
  kickoff TIMESTAMPTZ,
  predicted_home INTEGER NOT NULL,
  predicted_away INTEGER NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  tmp_home INTEGER,
  tmp_away INTEGER,
  reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_date, match_id)
);
GRANT SELECT ON public.daily_predictions TO anon;
GRANT SELECT ON public.daily_predictions TO authenticated;
GRANT ALL ON public.daily_predictions TO service_role;
ALTER TABLE public.daily_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Predictions are public" ON public.daily_predictions FOR SELECT USING (true);

CREATE TABLE public.ai_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_analyses TO authenticated;
GRANT ALL ON public.ai_analyses TO service_role;
ALTER TABLE public.ai_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read analyses" ON public.ai_analyses FOR SELECT TO authenticated USING (true);

CREATE TABLE public.tmp_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  tmp_home INTEGER,
  tmp_away INTEGER,
  predicted_home INTEGER,
  predicted_away INTEGER,
  confidence INTEGER,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.tmp_analyses TO authenticated;
GRANT ALL ON public.tmp_analyses TO service_role;
ALTER TABLE public.tmp_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tmp analyses" ON public.tmp_analyses FOR SELECT TO authenticated USING (auth.uid() = user_id);