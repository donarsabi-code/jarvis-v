/**
 * Moteur JARVIS local — 100 % gratuit, illimité, sans appel LLM ni crédit.
 * Il calcule le TMP (Team Momentum Performance), projette un score exact via
 * un modèle de Poisson pondéré, et rédige l'analyse en français, style JARVIS.
 */
import type { FormItem, MatchDetail, TeamStats } from "./fotmob.server";

export type EngineOutput = {
  tmpHome: number;
  tmpAway: number;
  home: number;
  away: number;
  confidence: number;
  probs: { home: number; draw: number; away: number };
  bothScore: number;
  over25: number;
  analysis: string;
  reasoning: string;
};

export const HOME_EDGE = 1.12;
export const AWAY_MALUS = 0.94;

function fact(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(k: number, lambda: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact(k);
}

export function clampLambda(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1.05;
  return Math.max(0.25, Math.min(3.6, x));
}

function formPoints(form: FormItem[]): number {
  // Pondération dégressive : le match le plus récent pèse le plus.
  const weights = [1, 0.85, 0.7, 0.55, 0.4];
  let num = 0;
  let den = 0;
  form.slice(0, 5).forEach((f, i) => {
    const w = weights[i] ?? 0.3;
    const pts = f.result === "W" ? 3 : f.result === "D" ? 1 : 0;
    num += pts * w;
    den += 3 * w;
  });
  return den ? num / den : 0.5;
}

/** TMP 0-100 : élan récent pondéré (points, diff de buts, attaque, défense). */
export function computeTmp(stats: TeamStats, form: FormItem[]): number {
  const played = Math.max(1, stats.wins + stats.draws + stats.losses);
  const momentum = formPoints(form); // 0-1
  const diff = (stats.scored - stats.conceded) / played; // ~ -3..3
  const attack = Math.min(1, stats.avgScored / 2.5);
  const defense = Math.min(1, 1 - stats.avgConceded / 3);
  const sheets = Math.min(1, stats.cleanSheets / Math.min(5, played));

  const raw =
    momentum * 46 +
    (Math.max(-2.5, Math.min(2.5, diff)) + 2.5) * 6 + // 0-30
    attack * 10 +
    Math.max(0, defense) * 9 +
    sheets * 5;

  return Math.max(1, Math.min(100, Math.round(raw)));
}

function h2hBias(summary: [number, number, number]): number {
  const [w, d, l] = summary;
  const total = w + d + l;
  if (!total) return 0;
  return ((w - l) / total) * 0.18; // ±18 % sur les lambdas
}

export function buildGrid(lh: number, la: number) {
  const grid: Array<{ h: number; a: number; p: number }> = [];
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) grid.push({ h, a, p: poisson(h, lh) * poisson(a, la) });
  }
  return grid.sort((x, y) => y.p - x.p);
}

type Side = { name: string; stats: TeamStats; form: FormItem[] };

export function analyseDuel(
  home: Side,
  away: Side,
  ctx: { league?: string | null; stadium?: string | null; h2h?: [number, number, number]; h2hCount?: number } = {},
): EngineOutput {
  const tmpHome = computeTmp(home.stats, home.form);
  const tmpAway = computeTmp(away.stats, away.form);
  const gap = tmpHome - tmpAway;
  const abs = Math.abs(gap);
  const bias = ctx.h2h ? h2hBias(ctx.h2h) : 0;

  const lh = clampLambda(
    ((home.stats.avgScored + away.stats.avgConceded) / 2) * HOME_EDGE * (1 + gap / 220 + bias),
  );
  const la = clampLambda(
    ((away.stats.avgScored + home.stats.avgConceded) / 2) * AWAY_MALUS * (1 - gap / 220 - bias),
  );

  const grid = buildGrid(lh, la);
  const best = grid[0]!;
  const bestProb = Math.round(best.p * 1000) / 10;

  let pH = 0;
  let pD = 0;
  let pA = 0;
  let bts = 0;
  let over = 0;
  for (const g of grid) {
    if (g.h > g.a) pH += g.p;
    else if (g.h === g.a) pD += g.p;
    else pA += g.p;
    if (g.h > 0 && g.a > 0) bts += g.p;
    if (g.h + g.a > 2) over += g.p;
  }
  const norm = pH + pD + pA || 1;
  const probs = {
    home: Math.round((pH / norm) * 1000) / 10,
    draw: Math.round((pD / norm) * 1000) / 10,
    away: Math.round((pA / norm) * 1000) / 10,
  };

  const topOutcome = Math.max(probs.home, probs.draw, probs.away);
  const confidence = Math.max(38, Math.min(93, Math.round(topOutcome * 0.7 + abs * 0.6 + best.p * 100)));

  const lecture =
    abs > 25
      ? "domination nette"
      : abs >= 10
        ? "avantage marqué"
        : "équilibre serré, le nul entre pleinement dans l'équation";
  const leader = gap === 0 ? null : gap > 0 ? home : away;

  const fmt = (s: Side) =>
    s.form
      .slice(0, 5)
      .map((f) => f.result)
      .join("·") || "n/d";

  const analysis = [
    `Monsieur, lecture TMP terminée${ctx.league ? ` sur ${ctx.league}` : ""}${ctx.stadium ? `, ${ctx.stadium}` : ""}.`,
    ``,
    `**1) Lecture TMP** — ${home.name} : **${tmpHome}/100** · ${away.name} : **${tmpAway}/100**. Écart de ${abs} point(s) : ${lecture}${leader ? `, à l'avantage de ${leader.name}` : ""}.`,
    ``,
    `**2) Forme & tendances** — ${home.name} : ${fmt(home)} (${home.stats.wins}V·${home.stats.draws}N·${home.stats.losses}D, ${home.stats.avgScored.toFixed(2)} but marqué et ${home.stats.avgConceded.toFixed(2)} encaissé par match, ${home.stats.cleanSheets} clean sheet). ${away.name} : ${fmt(away)} (${away.stats.wins}V·${away.stats.draws}N·${away.stats.losses}D, ${away.stats.avgScored.toFixed(2)} / ${away.stats.avgConceded.toFixed(2)}, ${away.stats.cleanSheets} clean sheet).`,
    ``,
    ctx.h2h
      ? `**3) Confrontations directes** — ${ctx.h2h[0]}V · ${ctx.h2h[1]}N · ${ctx.h2h[2]}D pour ${home.name} sur ${ctx.h2hCount ?? ctx.h2h[0] + ctx.h2h[1] + ctx.h2h[2]} duel(s) recensé(s). Correction appliquée au modèle : ${(bias * 100).toFixed(1)} %.`
      : `**3) Confrontations directes** — aucune donnée H2H exploitable, le modèle s'appuie exclusivement sur l'élan récent.`,
    ``,
    `**4) Projection** — espérance de buts ${lh.toFixed(2)} contre ${la.toFixed(2)}. Probabilités : ${home.name} ${probs.home} % · nul ${probs.draw} % · ${away.name} ${probs.away} %. Les deux marquent : ${Math.round(bts * 100)} %. Plus de 2,5 buts : ${Math.round(over * 100)} %.`,
    ``,
    `**Score exact retenu : ${home.name} ${best.h} - ${best.a} ${away.name}** · probabilité ${bestProb} % · confiance ${confidence} %. Une seule projection est retenue : c'est celle-là, Monsieur.`,
  ].join("\n");

  const reasoning =
    `TMP ${tmpHome} contre ${tmpAway}, soit ${abs} point(s) d'écart : ${lecture}. ` +
    `Espérance de buts ${lh.toFixed(2)}/${la.toFixed(2)} pour ${probs.home} % · ${probs.draw} % · ${probs.away} %. ` +
    `Score exact retenu ${best.h}-${best.a}, confiance ${confidence} %.`;

  return {
    tmpHome,
    tmpAway,
    home: best.h,
    away: best.a,
    confidence,
    probs,
    bothScore: Math.round(bts * 100),
    over25: Math.round(over * 100),
    analysis,
    reasoning,
  };
}

export function analyseMatch(detail: MatchDetail): EngineOutput {
  return analyseDuel(
    { name: detail.home.name, stats: detail.stats.home, form: detail.form.home },
    { name: detail.away.name, stats: detail.stats.away, form: detail.form.away },
    {
      league: detail.league,
      stadium: detail.stadium,
      h2h: detail.h2h.summary,
      h2hCount: detail.h2h.matches.length,
    },
  );
}