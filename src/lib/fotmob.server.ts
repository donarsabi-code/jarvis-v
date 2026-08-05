// Server-only FotMob proxy + analytics aggregation.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BASE = "https://www.fotmob.com/api/data";

async function fotmob<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`FotMob ${res.status}`);
  return (await res.json()) as T;
}

export const teamLogo = (id: number | string) =>
  `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

export type ListedMatch = {
  id: string;
  home: string;
  away: string;
  homeId: number;
  awayId: number;
  homeScore: number | null;
  awayScore: number | null;
  utcTime: string | null;
  statusShort: string | null;
  started: boolean;
  finished: boolean;
  cancelled: boolean;
};

export type LeagueGroup = {
  id: number;
  name: string;
  ccode: string;
  matches: ListedMatch[];
};

type RawLeagues = {
  leagues?: Array<{
    id: number;
    name: string;
    ccode: string;
    matches?: Array<{
      id: number | string;
      home: { id: number; name: string; score?: number };
      away: { id: number; name: string; score?: number };
      status?: {
        utcTime?: string;
        started?: boolean;
        finished?: boolean;
        cancelled?: boolean;
        scoreStr?: string;
        reason?: { short?: string };
      };
    }>;
  }>;
};

export async function fetchMatchesByDate(date: string): Promise<LeagueGroup[]> {
  const raw = await fotmob<RawLeagues>(`/matches?date=${date}`);
  return (raw.leagues ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    ccode: l.ccode,
    matches: (l.matches ?? []).map((m) => ({
      id: String(m.id),
      home: m.home?.name ?? "",
      away: m.away?.name ?? "",
      homeId: m.home?.id ?? 0,
      awayId: m.away?.id ?? 0,
      homeScore: m.status?.started ? (m.home?.score ?? null) : null,
      awayScore: m.status?.started ? (m.away?.score ?? null) : null,
      utcTime: m.status?.utcTime ?? null,
      statusShort: m.status?.reason?.short ?? null,
      started: !!m.status?.started,
      finished: !!m.status?.finished,
      cancelled: !!m.status?.cancelled,
    })),
  }));
}

export type FormItem = {
  result: string;
  score: string;
  home: string;
  away: string;
  date: string | null;
};

export type TeamStats = {
  wins: number;
  draws: number;
  losses: number;
  scored: number;
  conceded: number;
  avgScored: number;
  avgConceded: number;
  scoredInAll: boolean;
  cleanSheets: number;
  /** Team Momentum Performance ranking, 0-100 (Betclan-style momentum score). */
  tmp: number;
};

export type MatchDetail = {
  matchId: string;
  league: string;
  round: string | null;
  stadium: string | null;
  city: string | null;
  referee: string | null;
  kickoff: string | null;
  started: boolean;
  finished: boolean;
  home: { id: number; name: string };
  away: { id: number; name: string };
  score: { home: number | null; away: number | null };
  form: { home: FormItem[]; away: FormItem[] };
  stats: { home: TeamStats; away: TeamStats };
  h2h: { summary: [number, number, number]; matches: FormItem[] };
};

type RawForm = Array<{
  resultString?: string;
  score?: string;
  date?: { utcTime?: string };
  home?: { name?: string; isOurTeam?: boolean };
  away?: { name?: string; isOurTeam?: boolean };
}>;

function computeStats(form: FormItem[], teamName: string): TeamStats {
  let wins = 0,
    draws = 0,
    losses = 0,
    scored = 0,
    conceded = 0,
    cleanSheets = 0,
    scoredInAll = form.length > 0;
  const weights = [1.5, 1.3, 1.0, 0.8, 0.6];
  let momentum = 0;
  let weightTotal = 0;

  form.forEach((f, i) => {
    const parts = f.score.split("-").map((s) => Number(s.trim()));
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    const isHome = f.home === teamName;
    const gf = isHome ? a : b;
    const ga = isHome ? b : a;
    if (Number.isFinite(gf) && Number.isFinite(ga)) {
      scored += gf;
      conceded += ga;
      if (ga === 0) cleanSheets += 1;
      if (gf === 0) scoredInAll = false;
    }
    if (f.result === "W") wins++;
    else if (f.result === "D") draws++;
    else losses++;
    const w = weights[i] ?? 0.5;
    const pts = f.result === "W" ? 3 : f.result === "D" ? 1 : 0;
    const diff = Math.max(-3, Math.min(3, (gf || 0) - (ga || 0)));
    momentum += w * (pts + diff * 0.5);
    weightTotal += w * 4.5;
  });

  const n = form.length || 1;
  return {
    wins,
    draws,
    losses,
    scored,
    conceded,
    avgScored: Math.round((scored / n) * 100) / 100,
    avgConceded: Math.round((conceded / n) * 100) / 100,
    scoredInAll,
    cleanSheets,
    tmp: weightTotal ? Math.max(0, Math.min(100, Math.round((momentum / weightTotal) * 100))) : 50,
  };
}

function mapForm(raw: RawForm): FormItem[] {
  return (raw ?? []).slice(0, 5).map((f) => ({
    result: f.resultString ?? "-",
    score: f.score ?? "0 - 0",
    home: f.home?.name ?? "",
    away: f.away?.name ?? "",
    date: f.date?.utcTime ?? null,
  }));
}

export async function fetchMatchDetails(matchId: string): Promise<MatchDetail> {
  const raw = await fotmob<Record<string, any>>(`/matchDetails?matchId=${matchId}`);
  const g = raw['general'] ?? {};
  const facts = raw['content']?.matchFacts ?? {};
  const info = facts.infoBox ?? {};
  const teamForm: RawForm[] = facts.teamForm ?? [[], []];
  const homeName = g.homeTeam?.name ?? "";
  const awayName = g.awayTeam?.name ?? "";
  const homeForm = mapForm(teamForm[0] ?? []);
  const awayForm = mapForm(teamForm[1] ?? []);
  const h2hRaw = raw['content']?.h2h ?? {};

  return {
    matchId: String(g.matchId ?? matchId),
    league: g.leagueName ?? "",
    round: g.leagueRoundName ?? null,
    stadium: info.Stadium?.name ?? null,
    city: info.Stadium?.city ?? null,
    referee: info.Referee?.text ?? null,
    kickoff: g.matchTimeUTCDate ?? null,
    started: !!g.started,
    finished: !!g.finished,
    home: { id: g.homeTeam?.id ?? 0, name: homeName },
    away: { id: g.awayTeam?.id ?? 0, name: awayName },
    score: {
      home: raw['header']?.teams?.[0]?.score ?? null,
      away: raw['header']?.teams?.[1]?.score ?? null,
    },
    form: { home: homeForm, away: awayForm },
    stats: { home: computeStats(homeForm, homeName), away: computeStats(awayForm, awayName) },
    h2h: {
      summary: (h2hRaw.summary ?? [0, 0, 0]) as [number, number, number],
      matches: (h2hRaw.matches ?? []).slice(0, 8).map((m: any) => ({
        result: m.status?.reason?.short ?? "FT",
        score: m.status?.scoreStr ?? "-",
        home: m.home?.name ?? "",
        away: m.away?.name ?? "",
        date: m.status?.utcTime ?? null,
      })),
    },
  };
}

/** Resolve a free-text team name to a FotMob team + its recent form. */
export async function searchTeam(
  name: string,
): Promise<{ id: number; name: string; logo: string } | null> {
  const res = await fetch(
    `https://apigw.fotmob.com/searchapi/suggest?term=${encodeURIComponent(name)}&lang=fr,en`,
    { headers: { "User-Agent": UA } },
  ).catch(() => null);
  if (res && res.ok) {
    const json: any = await res.json().catch(() => null);
    const hit = json?.squad?.dataset?.[0] ?? json?.teams?.[0];
    if (hit) {
      const id = Number(hit.id);
      return { id, name: hit.name ?? name, logo: teamLogo(id) };
    }
  }
  return null;
}