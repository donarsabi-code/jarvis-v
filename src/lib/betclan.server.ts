/**
 * Source TMP officielle — BetClan (Team Momentum Performance ranking).
 *
 * Ce module scrape la véritable notion de TMP telle qu'elle est publiée sur
 * betclan.com : points TMP par équipe, forme sur 15 matchs, moyennes de buts,
 * taux over 2.5, confrontations directes et verdict algorithmique du site
 * (vainqueur, BTTS, total de buts, score exact) avec leurs probabilités.
 *
 * Strictement serveur. Résultats mis en cache en mémoire (30 min) puis en
 * base (`betclan_cache`) afin de ne jamais marteler la source.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const INDEX_TTL = 10 * 60 * 1000;
const DETAIL_TTL = 30 * 60 * 1000;

export type BetclanTeamStats = {
  form: string[];
  wins: number;
  draws: number;
  losses: number;
  played: number;
  scored: number;
  conceded: number;
  avgScored: number;
  avgConceded: number;
  over25: number;
};

export type BetclanVerdict = {
  winner: string | null;
  winnerPct: number | null;
  btts: "Oui" | "Non" | null;
  bttsPct: number | null;
  totals: "Plus" | "Moins" | null;
  totalsPct: number | null;
  correctScore: [number, number] | null;
  correctScorePct: number | null;
};

export type BetclanData = {
  url: string;
  homeName: string;
  awayName: string;
  tmpHome: number;
  tmpAway: number;
  home: BetclanTeamStats | null;
  away: BetclanTeamStats | null;
  h2h: Array<{ date: string; home: string; away: string; hg: number; ag: number; league: string }>;
  verdict: BetclanVerdict;
};

// ---------------------------------------------------------------- utilitaires

const STOP = new Set([
  "fc", "cf", "sc", "ac", "afc", "cd", "ud", "sv", "if", "bk", "fk", "club",
  "de", "the", "calcio", "futbol", "football", "team", "sport", "sportif",
]);

export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ")
    .trim();
}

function tokens(s: string): string[] {
  return normName(s).split(" ").filter(Boolean);
}

/** Similarité 0-1 entre deux noms de clubs. */
function similar(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  if (A.join(" ") === B.join(" ")) return 1;
  let hit = 0;
  for (const t of A) {
    if (B.some((u) => u === t || (t.length >= 4 && (u.startsWith(t) || t.startsWith(u))))) hit++;
  }
  return hit / Math.max(A.length, B.length);
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "fr,en" },
  });
  if (!res.ok) throw new Error(`BetClan ${res.status}`);
  return res.text();
}

/** HTML → lignes de texte lisibles, dans l'ordre du document. */
function textLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "|")
    .replace(/&nbsp;?/g, " ")
    .replace(/&amp;/g, "&")
    .split("|")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ------------------------------------------------------------------- index

type IndexEntry = { url: string; home: string; away: string };
let indexCache: { at: number; rows: IndexEntry[] } | null = null;

/** Liste des matchs du jour sur BetClan avec l'URL de leur page prédiction. */
export async function betclanIndex(): Promise<IndexEntry[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL) return indexCache.rows;
  const html = await get("https://www.betclan.com/fr/livescores/");
  const rows: IndexEntry[] = [];
  const re =
    /href='(https:\/\/www\.betclan\.com\/[a-z]{2}\/predictionsdetails\/football\/\d+\/[^']+)'\s+title='([^']+?)\s+Pr[ée]diction/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const title = m[2]!.replace(/&amp;/g, "&");
    const parts = title.split(/\s+vs\s+/i);
    if (parts.length !== 2) continue;
    rows.push({ url: m[1]!, home: parts[0]!.trim(), away: parts[1]!.trim() });
  }
  indexCache = { at: Date.now(), rows };
  return rows;
}

/** Retrouve la page BetClan correspondant à une affiche donnée. */
export async function findBetclanUrl(home: string, away: string): Promise<IndexEntry | null> {
  const rows = await betclanIndex();
  let best: IndexEntry | null = null;
  let score = 0;
  for (const r of rows) {
    const direct = (similar(home, r.home) + similar(away, r.away)) / 2;
    const flip = (similar(home, r.away) + similar(away, r.home)) / 2;
    const s = Math.max(direct, flip);
    if (s > score) {
      score = s;
      best = r;
    }
  }
  return score >= 0.6 ? best : null;
}

// ------------------------------------------------------------------ parsing

function parseTeamStats(lines: string[], start: number): BetclanTeamStats | null {
  const slice = lines.slice(start, start + 70);
  const at = (label: string): string | null => {
    const i = slice.findIndex((l) => l === label);
    return i === -1 ? null : (slice[i + 1] ?? null);
  };
  const ratio = (label: string): [number, number] | null => {
    const v = at(label);
    const m = v?.match(/^(\d+)\/(\d+)$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const w = ratio("Victoires");
  const d = ratio("Match Nul");
  const l = ratio("Défaites");
  if (!w || !d || !l) return null;

  const fi = slice.findIndex((x) => x === "Forme");
  const form: string[] = [];
  for (let i = fi + 1; i < fi + 9 && i < slice.length; i++) {
    const v = slice[i]!;
    if (/^[WDL]$/.test(v)) form.push(v);
    else if (form.length) break;
  }

  const gi = slice.findIndex((x) => x === "Buts Marqués");
  const ci = slice.findIndex((x) => x === "Buts Concédés");
  const scored = gi > 0 ? (num(slice[gi - 1]) ?? 0) : 0;
  const conceded = ci > 0 ? (num(slice[ci - 1]) ?? 0) : 0;

  return {
    form,
    wins: w[0],
    draws: d[0],
    losses: l[0],
    played: w[1] || 15,
    scored,
    conceded,
    avgScored: num(at("Moy. Buts Marqués")) ?? (w[1] ? scored / w[1] : 0),
    avgConceded: num(at("Moy. Buts Concédés")) ?? (w[1] ? conceded / w[1] : 0),
    over25: num(at("Plus de 2.5")) ?? 0,
  };
}

export function parseBetclanPage(html: string, url: string): BetclanData | null {
  const tmps = [...html.matchAll(/class="progressgo-value tmpoints">\s*([\d.,]+)\s*</g)].map((m) =>
    Number(m[1]!.replace(",", ".")),
  );
  if (tmps.length < 2) return null;

  const lines = textLines(html);
  const ki = lines.findIndex((l) => l === "TMP Points");
  const homeName = ki >= 3 ? (lines[ki - 3] ?? "") : "";
  const awayName = ki >= 2 ? (lines[ki - 2] ?? "") : "";

  const forms = lines.reduce<number[]>((acc, l, i) => (l === "Forme" ? [...acc, i] : acc), []);
  const home = forms[0] != null ? parseTeamStats(lines, forms[0] - 4) : null;
  const away = forms[1] != null ? parseTeamStats(lines, forms[1] - 4) : null;

  const h2h: BetclanData["h2h"] = [];
  for (let i = 0; i < lines.length - 4; i++) {
    if (!/^\d{2}\.\d{2}\.\d{2}$/.test(lines[i]!)) continue;
    const sc = lines[i + 2]!.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!sc) continue;
    h2h.push({
      date: lines[i]!,
      home: lines[i + 1]!,
      away: lines[i + 3]!,
      hg: Number(sc[1]),
      ag: Number(sc[2]),
      league: lines[i + 4] ?? "",
    });
    if (h2h.length >= 10) break;
  }

  const text = lines.join(" \n ");
  const win = text.match(/([^\n]{2,60}?)\s+pour le Gagnant du match, avec une probabilité de (\d+)\s*%/);
  const btts = text.match(/(Oui|Non)\s+pour Les Deux Équipes Marquent, avec un pourcentage de (\d+)\s*%/);
  const tot = text.match(/nous prédisons\s+(Plus|Moins)\s+de 2\.5[^%]*?(\d+)\s*%/);
  const cs = text.match(/Résultat Correct de\s+(\d+)-(\d+)\s+qui a un pourcentage de\s+(\d+)\s*%/);

  return {
    url,
    homeName: homeName || "",
    awayName: awayName || "",
    tmpHome: tmps[0]!,
    tmpAway: tmps[1]!,
    home,
    away,
    h2h,
    verdict: {
      winner: win ? win[1]!.trim() : null,
      winnerPct: win ? Number(win[2]) : null,
      btts: btts ? (btts[1] as "Oui" | "Non") : null,
      bttsPct: btts ? Number(btts[2]) : null,
      totals: tot ? (tot[1] as "Plus" | "Moins") : null,
      totalsPct: tot ? Number(tot[2]) : null,
      correctScore: cs ? [Number(cs[1]), Number(cs[2])] : null,
      correctScorePct: cs ? Number(cs[3]) : null,
    },
  };
}

// --------------------------------------------------------------- récupération

const detailCache = new Map<string, { at: number; data: BetclanData | null }>();

async function scrape(url: string): Promise<BetclanData | null> {
  const hit = detailCache.get(url);
  if (hit && Date.now() - hit.at < DETAIL_TTL) return hit.data;
  let data: BetclanData | null = null;
  try {
    data = parseBetclanPage(await get(url), url);
  } catch {
    data = null;
  }
  detailCache.set(url, { at: Date.now(), data });
  return data;
}

/**
 * TMP officiel BetClan pour une affiche. Persiste le relevé dans
 * `betclan_cache` pour historisation et réutilisation.
 */
export async function fetchBetclan(home: string, away: string): Promise<BetclanData | null> {
  const key = `${normName(home)}|${normName(away)}`;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const cached = await supabaseAdmin
    .from("betclan_cache")
    .select("payload, scraped_at")
    .eq("pair_key", key)
    .maybeSingle();
  if (cached.data && Date.now() - new Date(cached.data.scraped_at as string).getTime() < DETAIL_TTL) {
    return cached.data.payload as unknown as BetclanData;
  }

  let entry: IndexEntry | null = null;
  try {
    entry = await findBetclanUrl(home, away);
  } catch {
    entry = null;
  }
  if (!entry) return (cached.data?.payload as unknown as BetclanData) ?? null;

  const data = await scrape(entry.url);
  if (!data) return (cached.data?.payload as unknown as BetclanData) ?? null;

  // Le TMP est toujours restitué dans l'ordre domicile → extérieur demandé.
  const flipped = similar(home, data.awayName) > similar(home, data.homeName);
  const oriented: BetclanData = flipped
    ? {
        ...data,
        homeName: data.awayName,
        awayName: data.homeName,
        tmpHome: data.tmpAway,
        tmpAway: data.tmpHome,
        home: data.away,
        away: data.home,
        verdict: {
          ...data.verdict,
          correctScore: data.verdict.correctScore
            ? [data.verdict.correctScore[1], data.verdict.correctScore[0]]
            : null,
        },
      }
    : data;

  await supabaseAdmin
    .from("betclan_cache")
    .upsert(
      {
        pair_key: key,
        url: oriented.url,
        home_team: oriented.homeName,
        away_team: oriented.awayName,
        tmp_home: oriented.tmpHome,
        tmp_away: oriented.tmpAway,
        payload: oriented as unknown as Record<string, unknown>,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "pair_key" },
    );

  return oriented;
}
