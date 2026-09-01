/**
 * Moteur LIVE JARVIS — la prédiction de score exact FINAL est délivrée à
 * partir de la 15e minute du match en temps réel, et elle est recalculée
 * automatiquement par le serveur à chaque rafraîchissement (elle ne se fige
 * pas sur le score courant).
 *
 * Logique logistique :
 *   1. Socle pré-match : 6 dernières confrontations de chaque équipe DANS
 *      LEUR CHAMPIONNAT, position au classement, points, différence de buts,
 *      enjeu, H2H toutes compétitions confondues.
 *   2. À partir de la 15e : injection de la vibration réelle (xG, tirs,
 *      cadrés, possession, grandes occasions, rouges) scrapée sur FotMob.
 *   3. Projection Poisson sur les 90 minutes, puis score exact final.
 */
import type { MatchDetail } from "./fotmob.server";
import {
  AWAY_MALUS,
  HOME_EDGE,
  buildGrid,
  clampLambda,
  analyseMatch,
  type EngineOutput,
} from "./jarvis-engine.server";

export const LOCK_MINUTE = 15;

/** Minute réelle : minute FotMob, sinon estimation depuis le coup d'envoi. */
export function liveMinute(detail: MatchDetail): number | null {
  if (detail.finished) return 90;
  if (typeof detail.live?.minute === "number" && detail.live.minute > 0) return detail.live.minute;
  if (!detail.started || !detail.kickoff) return null;
  const diff = (Date.now() - new Date(detail.kickoff).getTime()) / 60000;
  return diff > 0 ? Math.floor(diff) : null;
}

export type LiveGate =
  | { ready: true; minute: number }
  | { ready: false; minute: number | null; message: string };

export function checkLiveGate(detail: MatchDetail): LiveGate {
  const minute = liveMinute(detail);
  if (minute !== null && minute >= LOCK_MINUTE) return { ready: true, minute };
  const reste = minute === null ? null : LOCK_MINUTE - minute;
  return {
    ready: false,
    minute,
    message:
      "Monsieur, ce match ne peut pas encore générer la prédiction. " +
      (minute === null
        ? "Le coup d'envoi n'a pas encore été donné : attendez la minute du lancement de la prédiction, la 15ᵉ minute du match en temps réel, pour lancer l'analyse."
        : `Nous sommes à la ${minute}ᵉ minute : attendez la minute du lancement de la prédiction, la 15ᵉ minute du match en temps réel (encore ${reste} minute(s)), pour lancer l'analyse.`) +
      " D'ici là, l'élément analytique corrige sa lecture en permanence.",
  };
}

function rankLabel(row: { position: number } | null, teams: number) {
  if (!row || !row.position) return "position au classement non communiquée";
  if (row.position === 1) return "1ᵉʳ du classement";
  if (teams && row.position >= teams) return `${row.position}ᵉ et dernier du classement`;
  return `${row.position}ᵉ au classement${teams ? ` sur ${teams}` : ""}`;
}

/** Enjeu déduit de la place au classement. */
function stakeLabel(pos: number, teams: number): string {
  if (!pos || !teams) return "enjeu non quantifiable";
  const ratio = pos / teams;
  if (ratio <= 0.2) return "course au titre / haut de tableau, obligation de résultat";
  if (ratio <= 0.45) return "chasse aux places européennes, marge d'erreur réduite";
  if (ratio >= 0.85) return "lutte pour le maintien, urgence absolue de points";
  if (ratio >= 0.7) return "zone rouge proche, pression défensive forte";
  return "ventre mou, match d'ambition plus que de survie";
}

export type LiveEngineOutput = EngineOutput & {
  minute: number;
  currentScore: [number, number];
  /** false : la lecture est réévaluée à chaque rafraîchissement serveur. */
  locked: false;
};

/**
 * Prédiction FINALE : socle pré-match (championnat, 6 derniers, classement,
 * enjeu, H2H) + vibration en direct à partir de la 15e minute.
 */
export function analyseLiveMatch(detail: MatchDetail): LiveEngineOutput {
  const minute = Math.max(LOCK_MINUTE, liveMinute(detail) ?? LOCK_MINUTE);
  const base = analyseMatch(detail);

  const ch = detail.score.home ?? 0;
  const ca = detail.score.away ?? 0;
  const ls = detail.liveStats;
  const played = Math.max(1, Math.min(minute, 90));
  const remaining = Math.max(1, 90 - Math.min(minute, 88));

  // 1) Socle pré-match : forme championnat + écart TMP + pression de tableau.
  const gap = base.tmpHome - base.tmpAway;
  const teams = detail.standings.teams;
  const posH = detail.standings.home?.position ?? 0;
  const posA = detail.standings.away?.position ?? 0;
  const tablePush = teams && posH && posA ? ((posA - posH) / teams) * 0.16 : 0;
  const h2hTotal = detail.h2h.summary[0] + detail.h2h.summary[1] + detail.h2h.summary[2];
  const h2hBias = h2hTotal ? ((detail.h2h.summary[0] - detail.h2h.summary[2]) / h2hTotal) * 0.12 : 0;

  const preLh = clampLambda(
    ((detail.stats.home.avgScored + detail.stats.away.avgConceded) / 2) *
      HOME_EDGE *
      (1 + gap / 220 + tablePush + h2hBias),
  );
  const preLa = clampLambda(
    ((detail.stats.away.avgScored + detail.stats.home.avgConceded) / 2) *
      AWAY_MALUS *
      (1 - gap / 220 - tablePush - h2hBias),
  );

  // 2) Vibration en direct : rythme réel projeté sur 90 minutes.
  const liveRate = (i: 0 | 1) => {
    if (!ls) return i === 0 ? preLh : preLa;
    const x =
      ls.xg[i] > 0 ? ls.xg[i] : ls.onTarget[i] * 0.28 + ls.shots[i] * 0.06 + ls.bigChances[i] * 0.35;
    const poss = (ls.possession[i] || 50) / 50;
    return ((x / played) * 90) * (0.85 + poss * 0.15);
  };

  const redH = ls?.reds[0] ?? 0;
  const redA = ls?.reds[1] ?? 0;
  const redFactorH = Math.max(0.3, 1 - redH * 0.28 + redA * 0.22);
  const redFactorA = Math.max(0.3, 1 - redA * 0.28 + redH * 0.22);

  // Renversement de situation : l'équipe menée pousse davantage.
  const chase = ch === ca ? 0 : ch > ca ? -0.08 : 0.08;

  // 3) Espérance FULL-MATCH (et non un simple ajout au score courant).
  const weightLive = Math.min(0.6, 0.25 + (played / 90) * 0.5);
  const fullLh = clampLambda((preLh * (1 - weightLive) + liveRate(0) * weightLive) * redFactorH * (1 + chase));
  const fullLa = clampLambda((preLa * (1 - weightLive) + liveRate(1) * weightLive) * redFactorA * (1 - chase));

  // Buts encore attendus sur le temps restant, cohérents avec l'espérance 90'.
  const lhRest = clampLambda(Math.max(0.08, fullLh * (remaining / 90)));
  const laRest = clampLambda(Math.max(0.08, fullLa * (remaining / 90)));

  const grid = buildGrid(lhRest, laRest);
  const best = grid[0]!;
  const total = grid.reduce((s, g) => s + g.p, 0) || 1;
  const finalH = ch + best.h;
  const finalA = ca + best.a;

  let pH = 0, pD = 0, pA = 0, bts = 0, over = 0;
  for (const g of grid) {
    const th = ch + g.h;
    const ta = ca + g.a;
    if (th > ta) pH += g.p;
    else if (th === ta) pD += g.p;
    else pA += g.p;
    if (th > 0 && ta > 0) bts += g.p;
    if (th + ta > 2) over += g.p;
  }
  const norm = pH + pD + pA || 1;
  const probs = {
    home: Math.round((pH / norm) * 1000) / 10,
    draw: Math.round((pD / norm) * 1000) / 10,
    away: Math.round((pA / norm) * 1000) / 10,
  };
  const bestProb = Math.round((best.p / total) * 1000) / 10;
  const top = Math.max(probs.home, probs.draw, probs.away);
  const confidence = Math.max(45, Math.min(96, Math.round(top * 0.62 + bestProb * 0.8 + 22)));

  const tempo = ls
    ? `Possession ${ls.possession[0]} % / ${ls.possession[1]} %, tirs ${ls.shots[0]}-${ls.shots[1]} (dont ${ls.onTarget[0]}-${ls.onTarget[1]} cadrés), xG ${ls.xg[0].toFixed(2)}-${ls.xg[1].toFixed(2)}, ${ls.bigChances[0]}-${ls.bigChances[1]} grande(s) occasion(s), corners ${ls.corners[0]}-${ls.corners[1]}${redH + redA ? `, carton(s) rouge ${redH}-${redA}` : ""}.`
    : "Statistiques live encore partielles : le modèle s'appuie sur le socle championnat, le classement et l'élan TMP.";

  const vibration =
    ch === ca
      ? "Score de parité : la vibration reste ouverte, aucun camp n'a imposé son autorité."
      : ch > ca
        ? `${detail.home.name} mène : tout se joue sur la capacité de ${detail.away.name} à renverser la situation.`
        : `${detail.away.name} mène : ${detail.home.name} doit impérativement réagir pour ramener cette victoire.`;

  const leagueForm = (side: "home" | "away") => {
    const f = detail.form[side];
    const inLeague = f.filter((x) => x.tournament && x.tournament === detail.league).length;
    return `${f.slice(0, 6).map((x) => x.result).join("·") || "n/d"} (${inLeague || f.length} sur ${detail.league || "championnat"})`;
  };

  const analysis = [
    `Monsieur, analyse déclenchée à la ${minute}ᵉ minute du match en temps réel. La lecture n'est pas figée sur le score courant : elle est réévaluée à chaque relevé serveur.`,
    ``,
    `**1) Championnat, classement & enjeu** — ${detail.league || "compétition non communiquée"}${detail.round ? ` · ${detail.round}` : ""}${detail.stadium ? ` · ${detail.stadium}` : ""}. ${detail.home.name} : ${rankLabel(detail.standings.home, teams)}${detail.standings.home ? ` (${detail.standings.home.points} pts, diff ${detail.standings.home.goalDiff}, ${detail.standings.home.played} matchs)` : ""} — ${stakeLabel(posH, teams)}. ${detail.away.name} : ${rankLabel(detail.standings.away, teams)}${detail.standings.away ? ` (${detail.standings.away.points} pts, diff ${detail.standings.away.goalDiff}, ${detail.standings.away.played} matchs)` : ""} — ${stakeLabel(posA, teams)}. Pression de tableau injectée : ${(tablePush * 100).toFixed(1)} %.`,
    ``,
    `**2) TMP — 6 dernières sorties de championnat** — ${detail.home.name} : **${base.tmpHome}/100**, ${leagueForm("home")}, ${detail.stats.home.avgScored.toFixed(2)} but marqué / ${detail.stats.home.avgConceded.toFixed(2)} encaissé par match, ${detail.stats.home.cleanSheets} clean sheet. ${detail.away.name} : **${base.tmpAway}/100**, ${leagueForm("away")}, ${detail.stats.away.avgScored.toFixed(2)} / ${detail.stats.away.avgConceded.toFixed(2)}, ${detail.stats.away.cleanSheets} clean sheet.`,
    ``,
    `**3) Vibration en direct (0-${minute}')** — Score courant ${ch}-${ca}. ${tempo} ${vibration} Poids accordé au direct dans le modèle : ${Math.round(weightLive * 100)} %, le reste provient du socle championnat.`,
    ``,
    `**4) Confrontations directes** — ${detail.h2h.summary[0]}V · ${detail.h2h.summary[1]}N · ${detail.h2h.summary[2]}D pour ${detail.home.name} sur ${detail.h2h.matches.length} duel(s) recensé(s), championnats confondus. Correction H2H : ${(h2hBias * 100).toFixed(1)} %.`,
    ``,
    `**5) Projection 90 minutes** — espérance totale ${fullLh.toFixed(2)} contre ${fullLa.toFixed(2)}, dont ${lhRest.toFixed(2)} / ${laRest.toFixed(2)} sur les ${remaining} minutes restantes. Issue finale : ${detail.home.name} ${probs.home} % · nul ${probs.draw} % · ${detail.away.name} ${probs.away} %. Les deux marquent : ${Math.round(bts * 100)} %. Plus de 2,5 buts : ${Math.round(over * 100)} %.`,
    ``,
    `**Score exact final retenu : ${detail.home.name} ${finalH} - ${finalA} ${detail.away.name}** · probabilité ${bestProb} % · confiance ${confidence} %. Une seule prédiction, Monsieur.`,
  ].join("\n");

  const reasoning =
    `Analyse à la ${minute}' sur score ${ch}-${ca}. TMP ${base.tmpHome}/${base.tmpAway}, ` +
    `espérance 90' ${fullLh.toFixed(2)}/${fullLa.toFixed(2)}. Score final ${finalH}-${finalA}, confiance ${confidence} %.`;

  return {
    tmpHome: base.tmpHome,
    tmpAway: base.tmpAway,
    home: finalH,
    away: finalA,
    confidence,
    probs,
    bothScore: Math.round(bts * 100),
    over25: Math.round(over * 100),
    analysis,
    reasoning,
    minute,
    currentScore: [ch, ca],
    locked: false,
  };
}
