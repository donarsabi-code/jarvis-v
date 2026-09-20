/**
 * Moteur JARVIS local — 100 % gratuit, illimité, sans appel LLM ni crédit.
 * Il calcule le TMP (Team Momentum Performance), projette un score exact via
 * un modèle de Poisson pondéré, et rédige l'analyse en français, style JARVIS.
 */
import type { FormItem, MatchDetail, TeamStats } from "./fotmob.server";
import type { BetclanData } from "./betclan.server";

export type EngineOutput = {
  tmpHome: number;
  tmpAway: number;
  /** Points TMP officiels BetClan (null si la source n'a pas été atteinte). */
  tmpPointsHome: number | null;
  tmpPointsAway: number | null;
  betclanUrl: string | null;
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

type TableCtx = { position?: number | null; points?: number | null; teams?: number | null } | null;

/** Poussée du classement : ±1 = premier vs dernier. */
function tablePush(row: TableCtx, teams?: number | null): number {
  const pos = row?.position;
  const n = teams ?? row?.teams ?? 20;
  if (!pos || !n || n < 2) return 0;
  return 1 - (2 * (pos - 1)) / (n - 1); // +1 leader, -1 lanterne rouge
}

/** Volatilité de la forme : alternance de résultats = match imprévisible. */
function volatility(form: FormItem[]): number {
  const seq = form.slice(0, 6).map((f) => (f.result === "W" ? 3 : f.result === "D" ? 1 : 0));
  if (seq.length < 2) return 0.4;
  let flips = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) flips++;
  return Math.min(1, flips / (seq.length - 1));
}

export type LiveCtx = {
  minute: number;
  score: [number, number];
  stats: {
    possession: [number, number];
    shots: [number, number];
    onTarget: [number, number];
    xg: [number, number];
    corners: [number, number];
    bigChances: [number, number];
    reds: [number, number];
  } | null;
};

/** Seuil d'activation de la lecture du direct : 14,5 minutes de jeu. */
export const LIVE_THRESHOLD = 14.5;

export function analyseDuel(
  home: Side,
  away: Side,
  ctx: {
    league?: string | null;
    stadium?: string | null;
    h2h?: [number, number, number];
    h2hCount?: number;
    standings?: { home: TableCtx; away: TableCtx; teams?: number | null };
    live?: LiveCtx | null;
    /** Relevé TMP officiel BetClan (source de vérité du momentum). */
    betclan?: BetclanData | null;
  } = {},
): EngineOutput {

  const bc = ctx.betclan ?? null;

  // ---- TMP : la notion officielle BetClan prime sur l'estimation locale ----
  // rel ∈ [-1, 1] : déséquilibre de momentum mesuré sur les points TMP réels.
  const rel = bc && bc.tmpHome + bc.tmpAway > 0
    ? (bc.tmpHome - bc.tmpAway) / (bc.tmpHome + bc.tmpAway)
    : 0;
  const localHome = computeTmp(home.stats, home.form);
  const localAway = computeTmp(away.stats, away.form);
  const scaled = (r: number) => Math.max(1, Math.min(100, Math.round(50 + 70 * r)));
  const tmpHome = bc ? Math.round(localHome * 0.35 + scaled(rel) * 0.65) : localHome;
  const tmpAway = bc ? Math.round(localAway * 0.35 + scaled(-rel) * 0.65) : localAway;
  const gap = tmpHome - tmpAway;
  const abs = Math.abs(gap);
  const bias = ctx.h2h ? h2hBias(ctx.h2h) : 0;

  const pushH = tablePush(ctx.standings?.home ?? null, ctx.standings?.teams);
  const pushA = tablePush(ctx.standings?.away ?? null, ctx.standings?.teams);
  const tableGap = pushH - pushA; // -2..2
  const stake = Math.abs(tableGap); // extrémité de la confrontation

  const volH = volatility(home.form);
  const volA = volatility(away.form);
  const chaos = (volH + volA) / 2; // 0 = série stable, 1 = totalement imprévisible

  // Espérance de buts : moyenne des 6 matchs FotMob fusionnée avec les moyennes
  // BetClan sur 15 matchs, puis inclinée par le déséquilibre TMP réel.
  const mix = (fot: number, bcv: number | undefined | null) =>
    bcv != null && bcv > 0 ? fot * 0.55 + bcv * 0.45 : fot;
  const baseH = mix(
    (home.stats.avgScored + away.stats.avgConceded) / 2,
    bc?.home && bc?.away ? (bc.home.avgScored + bc.away.avgConceded) / 2 : null,
  );
  const baseA = mix(
    (away.stats.avgScored + home.stats.avgConceded) / 2,
    bc?.home && bc?.away ? (bc.away.avgScored + bc.home.avgConceded) / 2 : null,
  );

  const lh = clampLambda(
    baseH * HOME_EDGE * (1 + gap / 220 + bias + tableGap * 0.09 + rel * 0.3),
  );
  const la = clampLambda(
    baseA * AWAY_MALUS * (1 - gap / 220 - bias - tableGap * 0.09 - rel * 0.3),
  );

  // ---- Fusion passé + présent -------------------------------------------
  // Le passé (forme championnat, H2H, classement, enjeu) fixe l'espérance de
  // base. Le direct, lu uniquement à partir de 14,5 minutes, sert de signal
  // de rythme. Le score observé n'entre jamais comme plancher dans la grille :
  // le modèle conserve une projection indépendante sur l'ensemble du match.
  const live = ctx.live ?? null;
  const curH = live ? Math.max(0, live.score[0]) : 0;
  const curA = live ? Math.max(0, live.score[1]) : 0;

  const tempo = (side: 0 | 1, base: number): number => {
    if (!live) return 1;
    const per = Math.max(LIVE_THRESHOLD, live.minute) / 90;
    const goals = live.score[side];
    const goalPace = Math.min(3.2, goals / Math.max(0.2, per));
    if (!live.stats) {
      const goalSignal = base * 0.82 + goalPace * 0.18;
      return Math.max(0.7, Math.min(1.45, goalSignal / Math.max(0.2, base)));
    }
    const s = live.stats;
    const o = side === 0 ? 1 : 0;
    const xgRate = s.xg[side] / Math.max(0.05, per); // xG projeté sur 90'
    const shotWeight = s.shots[side] * 0.05 + s.onTarget[side] * 0.14 + s.bigChances[side] * 0.22;
    const chanceRate = shotWeight / Math.max(0.15, per);
    const observed = xgRate * 0.5 + chanceRate * 0.35 + goalPace * 0.15 || base;
    const poss = (s.possession[side] - 50) / 100; // ±0,5
    const men = (s.reds[o] - s.reds[side]) * 0.12; // supériorité numérique
    // Confiance dans le direct croissante avec le temps joué (max 55 %).
    const trust = Math.min(0.55, 0.2 + per * 0.5);
    const blended = base * (1 - trust) + observed * trust;
    return Math.max(0.55, Math.min(1.9, (blended / Math.max(0.2, base)) * (1 + poss * 0.18 + men)));
  };

  const lhLive = clampLambda(lh * tempo(0, lh));
  const laLive = clampLambda(la * tempo(1, la));

  // Projection indépendante du total final : aucune addition du score live.
  const grid = buildGrid(live ? lhLive : lh, live ? laLive : la);


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

  // Jugeote : la grille de Poisson seule tire vers les petits scores. On
  // repondère les candidats selon l'issue la plus probable, l'extrémité de la
  // confrontation (leader contre relégable), l'appétit offensif et le chaos.
  const favourite = probs.home >= probs.away && probs.home >= probs.draw
    ? "H"
    : probs.away >= probs.home && probs.away >= probs.draw
      ? "A"
      : "D";
  const appetite = (lh + la) / 2;

  // Verdict algorithmique BetClan : vainqueur, BTTS, total de buts et score
  // exact, avec leurs probabilités. Aucun score n'est exclu d'office : chaque
  // case de la grille est simplement repondérée par ces convictions.
  const v = bc?.verdict ?? null;
  const bcSide = v?.winner
    ? normLite(v.winner) === normLite(bc!.homeName) || normLite(v.winner) === normLite(home.name)
      ? "H"
      : "A"
    : null;

  const scored = grid.slice(0, 24).map((g) => {
    const outcome = g.h > g.a ? "H" : g.h === g.a ? "D" : "A";
    let w = g.p;
    if (outcome === favourite) w *= 1.35;
    // Une confrontation extrême autorise un écart plus large que le score modal.
    const margin = Math.abs(g.h - g.a);
    w *= 1 + stake * 0.22 * Math.min(margin, 3);
    // Matchs ouverts : on ne s'enferme pas sur un 1-0.
    w *= 1 + (appetite - 1.2) * 0.18 * (g.h + g.a);
    // Séries instables : le nul et les scénarios secondaires reprennent du poids.
    if (chaos > 0.6 && outcome === "D") w *= 1.12;

    if (v) {
      if (bcSide && v.winnerPct != null) {
        const force = (v.winnerPct - 33) / 100; // conviction relative
        if (outcome === bcSide) w *= 1 + Math.max(0, force) * 0.9;
        else if (outcome !== "D") w *= 1 - Math.max(0, force) * 0.45;
      }
      if (v.btts && v.bttsPct != null) {
        const yes = g.h > 0 && g.a > 0;
        const f = (v.bttsPct - 50) / 100;
        w *= 1 + (yes === (v.btts === "Oui") ? Math.max(0, f) * 0.8 : -Math.max(0, f) * 0.5);
      }
      if (v.totals && v.totalsPct != null) {
        const over = g.h + g.a > 2;
        const f = (v.totalsPct - 50) / 100;
        w *= 1 + (over === (v.totals === "Plus") ? Math.max(0, f) * 0.8 : -Math.max(0, f) * 0.5);
      }
      if (v.correctScore && v.correctScorePct != null) {
        if (g.h === v.correctScore[0] && g.a === v.correctScore[1]) {
          w *= 1 + (v.correctScorePct / 100) * 1.1;
        }
      }
    }
    return { ...g, w };
  });
  scored.sort((x, y) => y.w - x.w);
  const best = scored[0]!;
  const alt = scored.slice(1, 4);
  const bestProb = Math.round(best.p * 1000) / 10;

  const bestOutcome = best.h > best.a ? "H" : best.h === best.a ? "D" : "A";
  const align = bc ? (bcSide && bestOutcome === bcSide ? 7 : bcSide ? -4 : 3) : 0;

  const topOutcome = Math.max(probs.home, probs.draw, probs.away);
  const confidence = Math.max(
    35,
    Math.min(
      96,
      Math.round(topOutcome * 0.62 + abs * 0.5 + stake * 8 + best.p * 100 - chaos * 9 + align),
    ),
  );

  const lecture =
    abs > 25
      ? "domination nette"
      : abs >= 10
        ? "avantage marqué"
        : "équilibre serré, le nul entre pleinement dans l'équation";
  const leader = gap === 0 ? null : gap > 0 ? home : away;

  const fmt = (s: Side) =>
    s.form
      .slice(0, 6)
      .map((f) => f.result)
      .join("·") || "n/d";

  const place = (row: TableCtx, name: string) =>
    row?.position
      ? `${name} pointe ${row.position}${row.position === 1 ? "er" : "e"}${
          ctx.standings?.teams ? ` sur ${ctx.standings.teams}` : ""
        }${row.points != null ? ` avec ${row.points} point(s)` : ""}`
      : `${name} : position au classement non communiquée`;

  const enjeu =
    stake > 1.1
      ? `Confrontation aux extrémités du tableau : le rapport de force institutionnel est massif, l'obligation de résultat pèse presque entièrement sur ${tableGap > 0 ? away.name : home.name}.`
      : stake > 0.5
        ? `Écart de statut réel : ${tableGap > 0 ? home.name : away.name} a la légitimité comptable, l'autre joue le coup à renverser.`
        : `Statuts comparables : rien dans le classement ne tranche, la décision viendra de l'élan et du contexte de la rencontre.`;

  const nerf =
    chaos > 0.65
      ? `Séries instables des deux côtés (volatilité ${Math.round(chaos * 100)} %) : le scénario peut basculer, la projection intègre cette marge de renversement.`
      : chaos < 0.35
        ? `Séries très lisibles (volatilité ${Math.round(chaos * 100)} %) : les deux équipes répètent leurs schémas, la projection est peu exposée à la surprise.`
        : `Volatilité intermédiaire (${Math.round(chaos * 100)} %) : la trame reste lisible mais un fait de match peut la déplacer.`;

  const forces = (s: Side, other: Side) => {
    const bits: string[] = [];
    if (s.stats.avgScored >= 1.8) bits.push("volume offensif élevé");
    else if (s.stats.avgScored <= 0.9) bits.push("stérilité offensive");
    if (s.stats.avgConceded <= 0.8) bits.push("bloc défensif solide");
    else if (s.stats.avgConceded >= 1.8) bits.push("fragilité défensive nette");
    if (s.stats.cleanSheets >= 3) bits.push("habitude du clean sheet");
    if (s.stats.scoredInAll) bits.push("marque à chaque sortie");
    if (s.stats.avgScored > other.stats.avgConceded + 0.5) bits.push("profil taillé pour punir ce type d'adversaire");
    return bits.length ? bits.join(", ") : "profil sans trait dominant";
  };

  const analysis = [
    `Monsieur, lecture complète terminée${ctx.league ? ` sur ${ctx.league}` : ""}${ctx.stadium ? `, ${ctx.stadium}` : ""}.`,
    ``,
    `**1) Lecture TMP** — ${home.name} : **${tmpHome}/100** · ${away.name} : **${tmpAway}/100**. Écart de ${abs} point(s) : ${lecture}${leader ? `, à l'avantage de ${leader.name}` : ""}.`,
    ``,
    `**2) Forme sur 6 journées de championnat** — ${home.name} : ${fmt(home)} (${home.stats.wins}V·${home.stats.draws}N·${home.stats.losses}D, ${home.stats.avgScored.toFixed(2)} but marqué et ${home.stats.avgConceded.toFixed(2)} encaissé par match, ${home.stats.cleanSheets} clean sheet). ${away.name} : ${fmt(away)} (${away.stats.wins}V·${away.stats.draws}N·${away.stats.losses}D, ${away.stats.avgScored.toFixed(2)} / ${away.stats.avgConceded.toFixed(2)}, ${away.stats.cleanSheets} clean sheet).`,
    ``,
    `**3) Classement & enjeu** — ${place(ctx.standings?.home ?? null, home.name)} ; ${place(ctx.standings?.away ?? null, away.name)}. ${enjeu}`,
    ``,
    `**4) Forces et faiblesses** — ${home.name} : ${forces(home, away)}. ${away.name} : ${forces(away, home)}.`,
    ``,
    ctx.h2h
      ? `**5) Confrontations directes** — ${ctx.h2h[0]}V · ${ctx.h2h[1]}N · ${ctx.h2h[2]}D pour ${home.name} sur ${ctx.h2hCount ?? ctx.h2h[0] + ctx.h2h[1] + ctx.h2h[2]} duel(s) recensé(s). Correction appliquée au modèle : ${(bias * 100).toFixed(1)} %.`
      : `**5) Confrontations directes** — aucune donnée H2H exploitable, le modèle s'appuie sur l'élan récent et le rapport de classement.`,
    ``,
    `**6) Renversement & marge d'incertitude** — ${nerf}`,
    ``,
    `**7) Projection** — espérance de buts ${lh.toFixed(2)} contre ${la.toFixed(2)}. Probabilités : ${home.name} ${probs.home} % · nul ${probs.draw} % · ${away.name} ${probs.away} %. Les deux marquent : ${Math.round(bts * 100)} %. Plus de 2,5 buts : ${Math.round(over * 100)} %. Scénarios secondaires écartés après pondération : ${alt.map((g) => `${g.h}-${g.a}`).join(", ")}.`,
    ``,
    live
      ? `**8) Lecture du direct (relevé à la ${live.minute}ᵉ minute)** — ${
          live.stats
            ? ` · xG ${live.stats.xg[0].toFixed(2)}/${live.stats.xg[1].toFixed(2)} · tirs ${live.stats.shots[0]}/${live.stats.shots[1]} (cadrés ${live.stats.onTarget[0]}/${live.stats.onTarget[1]}) · grosses occasions ${live.stats.bigChances[0]}/${live.stats.bigChances[1]} · possession ${live.stats.possession[0]}/${live.stats.possession[1]} % · rouges ${live.stats.reds[0]}/${live.stats.reds[1]}`
            : " · statistiques détaillées non communiquées"
        }. Le résultat affiché n'est ni repris ni additionné : il sert uniquement d'indice de rythme avec les occasions créées. La projection complète (${lhLive.toFixed(2)} contre ${laLive.toFixed(2)}) reste fondée sur les 6 matchs de championnat, les H2H, le classement et l'enjeu.`
      : ``,
    live ? `` : ``,
    `**Score exact retenu : ${home.name} ${best.h} - ${best.a} ${away.name}** · probabilité brute ${bestProb} % · confiance ${confidence} %. Une seule projection est retenue, Monsieur : celle-là, et elle tient compte de l'extrémité réelle de cette confrontation${live ? ` ainsi que de tout ce qui a été relevé jusqu'à la ${live.minute}ᵉ minute` : ""}.`,

  ].join("\n");

  const reasoning =
    `TMP ${tmpHome} contre ${tmpAway} (${abs} pt, ${lecture}), enjeu de classement ${stake.toFixed(2)}, volatilité ${Math.round(chaos * 100)} %. ` +
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

/** Minute de jeu exploitable, ou null si le direct n'est pas lisible. */
export function liveMinuteOf(detail: MatchDetail): number | null {
  if (!detail.started || detail.finished || !detail.live.ongoing) return null;
  return detail.live.minute ?? null;
}

/** Le direct a-t-il atteint le seuil des 14,5 minutes de jeu ? */
export function liveReady(detail: MatchDetail): boolean {
  const m = liveMinuteOf(detail);
  return !detail.finished && detail.live.ongoing && m != null && m >= LIVE_THRESHOLD;
}

export function analyseMatch(detail: MatchDetail): EngineOutput {
  const minute = liveMinuteOf(detail);
  const useLive = minute != null && minute >= LIVE_THRESHOLD;
  return analyseDuel(
    { name: detail.home.name, stats: detail.stats.home, form: detail.form.home },
    { name: detail.away.name, stats: detail.stats.away, form: detail.form.away },
    {
      league: detail.league,
      stadium: detail.stadium,
      h2h: detail.h2h.summary,
      h2hCount: detail.h2h.matches.length,
      standings: {
        home: detail.standings.home,
        away: detail.standings.away,
        teams: detail.standings.teams,
      },
      live: useLive
        ? {
            minute,
            score: [detail.score.home ?? 0, detail.score.away ?? 0],
            stats: detail.liveStats,
          }
        : null,
    },
  );
}

