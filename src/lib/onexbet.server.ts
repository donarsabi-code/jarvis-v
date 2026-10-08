/**
 * Cotes 1xBet via l'API PulseScore (clé serveur PULSESCORE_API_KEY).
 * Quota très limité (500 requêtes/mois) : chaque page parcourue est stockée
 * dans `onexbet_odds`, et toute recherche interroge d'abord la base.
 */
import { normName } from "./betclan.server";

export type OnexbetOdds = {
  eventId: string;
  home: string;
  away: string;
  league: string | null;
  startTime: string | null;
  /** Probabilités implicites normalisées (marge retirée). */
  p1: number | null;
  pX: number | null;
  p2: number | null;
  over25: number | null;
  btts: number | null;
  /** Score exact "h-a" -> probabilité implicite normalisée. */
  cs: Record<string, number>;
  raw: { o1: number | null; oX: number | null; o2: number | null };
};

const BASE = "https://api.pulsescore.net/api/onexbet";
const FRESH_MS = 3 * 60 * 60 * 1000;
const MAX_PAGES = 6;

type Sel = { canonicalOutcome?: string; rawName?: string; odds?: number; line?: number | null; isActive?: boolean };
type Market = { canonicalMarket?: string; period?: string; selections?: Sel[] };
type Ev = { eventId: string; home: string; away: string; league?: string; startTime?: string; markets?: Market[] };

function norm(probs: number[]): number[] {
  const s = probs.reduce((a, b) => a + b, 0);
  return s > 0 ? probs.map((p) => p / s) : probs;
}

function extract(ev: Ev): OnexbetOdds {
  const ft = (ev.markets ?? []).filter((m) => m.period === "FULL_TIME");
  const mk = (c: string) => ft.find((m) => m.canonicalMarket === c);
  const odd = (m: Market | undefined, o: string, line?: number) =>
    m?.selections?.find((s) => s.canonicalOutcome === o && (line == null || s.line === line))?.odds ?? null;

  const mr = mk("MATCH_RESULT");
  const o1 = odd(mr, "HOME"), oX = odd(mr, "DRAW"), o2 = odd(mr, "AWAY");
  let p1: number | null = null, pX: number | null = null, p2: number | null = null;
  if (o1 && oX && o2) [p1, pX, p2] = norm([1 / o1, 1 / oX, 1 / o2]) as [number, number, number];

  const ouM = ft.find((m) => m.canonicalMarket === "OVER_UNDER" && m.selections?.some((s) => s.line === 2.5));
  const ov = odd(ouM, "OVER", 2.5), un = odd(ouM, "UNDER", 2.5);
  const over25 = ov && un ? norm([1 / ov, 1 / un])[0]! : null;

  const bt = mk("BOTH_TEAMS_TO_SCORE");
  const by = odd(bt, "YES"), bn = odd(bt, "NO");
  const btts = by && bn ? norm([1 / by, 1 / bn])[0]! : null;

  const cs: Record<string, number> = {};
  const csM = mk("CORRECT_SCORE");
  const pairs = (csM?.selections ?? [])
    .map((s) => ({ k: (s.rawName ?? "").trim(), o: s.odds ?? 0 }))
    .filter((x) => /^\d+-\d+$/.test(x.k) && x.o > 1);
  const tot = pairs.reduce((a, x) => a + 1 / x.o, 0);
  for (const x of pairs) cs[x.k] = 1 / x.o / (tot || 1);

  return {
    eventId: String(ev.eventId), home: ev.home, away: ev.away,
    league: ev.league ?? null, startTime: ev.startTime ?? null,
    p1, pX, p2, over25, btts, cs, raw: { o1, oX, o2 },
  };
}

function sim(a: string, b: string): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x) || x.split(" ")[0] === y.split(" ")[0];
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function orient(o: OnexbetOdds, home: string): OnexbetOdds {
  if (sim(o.home, home)) return o;
  const cs: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.cs)) { const [h, a] = k.split("-"); cs[`${a}-${h}`] = v; }
  return { ...o, home: o.away, away: o.home, p1: o.p2, p2: o.p1, cs, raw: { o1: o.raw.o2, oX: o.raw.oX, o2: o.raw.o1 } };
}

async function fromDb(home: string, away: string): Promise<OnexbetOdds | null> {
  const db = await admin();
  const since = new Date(Date.now() - FRESH_MS).toISOString();
  const key = normName(home).split(" ")[0] ?? "";
  if (!key) return null;
  const { data } = await db
    .from("onexbet_odds")
    .select("odds")
    .gte("fetched_at", since)
    .or(`home_norm.ilike.%${key}%,away_norm.ilike.%${key}%`)
    .limit(20);
  for (const r of data ?? []) {
    const o = r.odds as unknown as OnexbetOdds;
    if ((sim(o.home, home) && sim(o.away, away)) || (sim(o.home, away) && sim(o.away, home))) return orient(o, home);
  }
  return null;
}

async function store(list: OnexbetOdds[]) {
  if (!list.length) return;
  const db = await admin();
  const now = new Date().toISOString();
  await db.from("onexbet_odds").upsert(
    list.map((o) => ({
      event_id: o.eventId, home: o.home, away: o.away,
      home_norm: normName(o.home), away_norm: normName(o.away),
      league: o.league, start_time: o.startTime, odds: o as never, fetched_at: now,
    })),
    { onConflict: "event_id" },
  );
}

/** Cotes 1xBet du match, orientées domicile -> extérieur demandé. */
export async function fetchOnexbet(home: string, away: string): Promise<OnexbetOdds | null> {
  try {
    const cached = await fromDb(home, away);
    if (cached) return cached;
    const key = process.env["PULSESCORE_API_KEY"];
    if (!key) return null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`${BASE}/soccer/events?limit=30&page=${page}`, {
        headers: { "X-Secret": key, "Accept-Encoding": "gzip" },
      });
      if (!res.ok) {
        console.error(`PulseScore ${res.status}: ${await res.text().catch(() => "")}`);
        return null;
      }
      const body = (await res.json()) as { events?: Ev[]; hasNextPage?: boolean };
      const list = (body.events ?? []).map(extract);
      await store(list);
      const hit = list.find((o) => (sim(o.home, home) && sim(o.away, away)) || (sim(o.home, away) && sim(o.away, home)));
      if (hit) return orient(hit, home);
      if (!body.hasNextPage) break;
    }
  } catch (e) {
    console.error("onexbet", e);
  }
  return null;
}
