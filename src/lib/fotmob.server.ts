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
  /** Compétition du match de forme (sert à ne garder que le championnat). */
  tournament: string | null;
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
  /** État live : minute réelle du match en cours. */
  live: { minute: number | null; ongoing: boolean; statusText: string | null; halftime: boolean };
  /** Statistiques en direct (null avant le coup d'envoi). */
  liveStats: LiveStats | null;
  /** Contexte de championnat : place au classement, points, nb d'équipes. */
  standings: {
    home: TableRow | null;
    away: TableRow | null;
    teams: number;
  };
};

export type LiveStats = {
  possession: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  xg: [number, number];
  corners: [number, number];
  bigChances: [number, number];
  reds: [number, number];
};

export type TableRow = { position: number; points: number; played: number; goalDiff: number };

function parseMinute(raw: Record<string, any>): { minute: number | null; halftime: boolean; statusText: string | null } {
  const status = raw['header']?.status ?? raw['general']?.status ?? {};
  const short: string | undefined = status?.liveTime?.short ?? status?.liveTime?.long;
  const text: string | null = status?.reason?.long ?? status?.reason?.short ?? short ?? null;
  const halftime = typeof text === "string" && /half.?time|mi-temps|HT/i.test(text);
  if (typeof short === "string") {
    const m = short.match(/(\d+)/);
    if (m) return { minute: Number(m[1]), halftime, statusText: text };
  }
  if (halftime) return { minute: 45, halftime, statusText: text };
  return { minute: null, halftime, statusText: text };
}

function statPair(raw: Record<string, any>, matcher: RegExp): [number, number] | null {
  const periods = raw['content']?.stats?.Periods ?? raw['content']?.stats?.periods;
  const all = periods?.All ?? periods?.all;
  const groups: any[] = all?.stats ?? [];
  for (const g of groups) {
    for (const s of g?.stats ?? []) {
      const key = String(s?.title ?? s?.key ?? "");
      if (!matcher.test(key)) continue;
      const v = s?.stats ?? s?.value;
      if (!Array.isArray(v)) continue;
      const n = v.map((x: any) => {
        const num = Number(String(x ?? 0).replace(/[^\d.]/g, ""));
        return Number.isFinite(num) ? num : 0;
      });
      return [n[0] ?? 0, n[1] ?? 0];
    }
  }
  return null;
}

function parseLiveStats(raw: Record<string, any>): LiveStats | null {
  const possession = statPair(raw, /possession/i);
  const shots = statPair(raw, /total shots|tirs/i);
  if (!possession && !shots) return null;
  return {
    possession: possession ?? [50, 50],
    shots: shots ?? [0, 0],
    onTarget: statPair(raw, /on target|cadr/i) ?? [0, 0],
    xg: statPair(raw, /expected goals|xG/i) ?? [0, 0],
    corners: statPair(raw, /corner/i) ?? [0, 0],
    bigChances: statPair(raw, /big chance/i) ?? [0, 0],
    reds: statPair(raw, /red card/i) ?? [0, 0],
  };
}

async function fetchStandings(
  raw: Record<string, any>,
  homeId: number,
  awayId: number,
): Promise<{ home: TableRow | null; away: TableRow | null; teams: number }> {
  const url: string | undefined = raw['content']?.table?.url;
  if (!url) return { home: null, away: null, teams: 0 };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { home: null, away: null, teams: 0 };
    const xml = await res.text();
    const rows = [...xml.matchAll(/<t\s([^>]*)\/>/g)].map((m, i) => {
      const attrs: Record<string, string> = {};
      for (const a of m[1]!.matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
      return {
        id: Number(attrs['id'] ?? 0),
        position: i + 1,
        points: Number(attrs['p'] ?? 0),
        played:
          Number(attrs['w'] ?? 0) + Number(attrs['d'] ?? 0) + Number(attrs['l'] ?? 0),
        goalDiff: Number(attrs['g'] ?? 0) - Number(attrs['c'] ?? 0),
      };
    });
    const pick = (id: number): TableRow | null => {
      const r = rows.find((x) => x.id === id);
      return r ? { position: r.position, points: r.points, played: r.played, goalDiff: r.goalDiff } : null;
    };
    return { home: pick(homeId), away: pick(awayId), teams: rows.length };
  } catch {
    return { home: null, away: null, teams: 0 };
  }
}

type RawForm = Array<{
  resultString?: string;
  score?: string;
  date?: { utcTime?: string };
  home?: { name?: string; isOurTeam?: boolean };
  away?: { name?: string; isOurTeam?: boolean };
  tournament?: { name?: string; leagueName?: string };
  leagueName?: string;
  tournamentName?: string;
}>;

function computeStats(form: FormItem[], teamName: string): TeamStats {
  let wins = 0,
    draws = 0,
    losses = 0,
    scored = 0,
    conceded = 0,
    cleanSheets = 0,
    scoredInAll = form.length > 0;
  const weights = [1.5, 1.35, 1.2, 1.0, 0.8, 0.6];
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

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * 6 dernières confrontations, restreintes au championnat de la rencontre.
 * Si moins de 3 matchs de championnat sont exploitables, on complète avec
 * les autres compétitions pour ne jamais perdre la lecture de forme.
 */
function mapForm(raw: RawForm, league?: string): FormItem[] {
  const all: FormItem[] = (raw ?? []).map((f) => ({
    result: f.resultString ?? "-",
    score: f.score ?? "0 - 0",
    home: f.home?.name ?? "",
    away: f.away?.name ?? "",
    date: f.date?.utcTime ?? null,
    tournament: f.tournament?.name ?? f.tournament?.leagueName ?? f.leagueName ?? f.tournamentName ?? null,
  }));
  if (league) {
    const target = normalize(league);
    const inLeague = all.filter((f) => f.tournament && normalize(f.tournament) === target);
    if (inLeague.length >= 3) return inLeague.slice(0, 6);
  }
  return all.slice(0, 6);
}


export async function fetchMatchDetails(matchId: string): Promise<MatchDetail> {
  const raw = await fotmob<Record<string, any>>(`/matchDetails?matchId=${matchId}`);
  const g = raw['general'] ?? {};
  const facts = raw['content']?.matchFacts ?? {};
  const info = facts.infoBox ?? {};
  const teamForm: RawForm[] = facts.teamForm ?? [[], []];
  const homeName = g.homeTeam?.name ?? "";
  const awayName = g.awayTeam?.name ?? "";
  const leagueName: string = g.leagueName ?? "";
  const homeForm = mapForm(teamForm[0] ?? [], leagueName);
  const awayForm = mapForm(teamForm[1] ?? [], leagueName);
  const h2hRaw = raw['content']?.h2h ?? {};
  const homeId = g.homeTeam?.id ?? 0;
  const awayId = g.awayTeam?.id ?? 0;
  const { minute, halftime, statusText } = parseMinute(raw);

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
        tournament: m.tournament?.name ?? m.leagueName ?? null,
      })),
    },
    live: {
      minute,
      ongoing: !!g.started && !g.finished,
      statusText,
      halftime,
    },
    liveStats: g.started ? parseLiveStats(raw) : null,
    standings: await fetchStandings(raw, homeId, awayId),
  };
}

/** Resolve a free-text team name to a FotMob team. */
export async function searchTeam(
  name: string,
): Promise<{ id: number; name: string; logo: string } | null> {
  const res = await fetch(
    `https://apigw.fotmob.com/searchapi/suggest?term=${encodeURIComponent(name)}&lang=fr,en`,
    { headers: { "User-Agent": UA, Accept: "application/json" } },
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const json: any = await res.json().catch(() => null);
  const opt = json?.teamSuggest?.[0]?.options?.[0];
  if (!opt?.payload?.id) return null;
  const id = Number(opt.payload.id);
  return { id, name: String(opt.text ?? name).split("|")[0]!.trim(), logo: teamLogo(id) };
}

/** Recent form + TMP momentum score for a single team. */
export async function fetchTeamForm(
  teamId: number,
  teamName: string,
): Promise<{ form: FormItem[]; stats: TeamStats }> {
  const raw = await fotmob<Record<string, any>>(`/teams?id=${teamId}&tab=overview`);
  const primaryLeague: string | undefined =
    raw['overview']?.table?.[0]?.data?.leagueName ?? raw['details']?.latestSeason ? undefined : undefined;
  const form = mapForm((raw['overview']?.teamForm ?? []) as RawForm, primaryLeague);
  const realName = raw['details']?.name ?? teamName;
  return { form, stats: computeStats(form, realName) };
}