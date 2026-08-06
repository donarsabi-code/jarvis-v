import { fetchMatchDetails, fetchMatchesByDate, teamLogo } from "./fotmob.server";
import { analyseMatch } from "./jarvis-engine.server";

const PRIORITY = [
  "Premier League",
  "LaLiga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
  "Eredivisie",
  "Primeira Liga",
  "Championship",
  "MLS",
  "Brasileirão",
  "Liga Profesional",
];

function score(name: string) {
  const i = PRIORITY.findIndex((p) => name.toLowerCase().includes(p.toLowerCase()));
  return i === -1 ? 99 : i;
}

export type GeneratedPrediction = {
  match_date: string;
  match_id: string;
  league_name: string;
  home_team: string;
  away_team: string;
  home_logo: string;
  away_logo: string;
  kickoff: string | null;
  predicted_home: number;
  predicted_away: number;
  confidence: number;
  tmp_home: number;
  tmp_away: number;
  reasoning: string;
};

/** Generates the site's own 6 exact-score predictions of the day. */
export async function generateDailyPredictions(isoDate: string): Promise<GeneratedPrediction[]> {
  const compact = isoDate.replace(/-/g, "");
  const leagues = await fetchMatchesByDate(compact);

  const candidates = leagues
    .flatMap((l) =>
      l.matches
        .filter((m) => !m.started && !m.cancelled)
        .map((m) => ({ league: l.name, match: m, rank: score(l.name) })),
    )
    .sort((a, b) => a.rank - b.rank || (a.match.utcTime ?? "").localeCompare(b.match.utcTime ?? ""))
    .slice(0, 6);

  const out: GeneratedPrediction[] = [];

  for (const c of candidates) {
    try {
      const detail = await fetchMatchDetails(c.match.id);
      const res = analyseMatch(detail);

      out.push({
        match_date: isoDate,
        match_id: c.match.id,
        league_name: c.league,
        home_team: detail.home.name,
        away_team: detail.away.name,
        home_logo: teamLogo(detail.home.id),
        away_logo: teamLogo(detail.away.id),
        kickoff: detail.kickoff,
        predicted_home: Math.max(0, Math.round(res.home)),
        predicted_away: Math.max(0, Math.round(res.away)),
        confidence: Math.max(0, Math.min(100, Math.round(res.confidence))),
        tmp_home: res.tmpHome,
        tmp_away: res.tmpAway,
        reasoning: res.reasoning,
      });
    } catch (e) {
      console.error("prediction failed for", c.match.id, e);
    }
  }

  if (out.length) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("daily_predictions").upsert(out, { onConflict: "match_date,match_id" });
  }

  return out;
}