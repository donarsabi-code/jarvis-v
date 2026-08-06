import type { MatchDetail } from "./fotmob.server";

/** Analyse TMP déterministe, sans LLM — utilisée si le gateway IA est indisponible. */
export function localTmpAnalysis(d: MatchDetail): string {
  const h = d.stats.home;
  const a = d.stats.away;
  const gap = Math.round(h.tmp - a.tmp);
  const abs = Math.abs(gap);
  const lecture =
    abs > 25
      ? "domination nette"
      : abs >= 10
        ? "avantage marqué"
        : "match serré, le nul reste crédible";

  const base = (att: number, def: number) => (att + def) / 2;
  let sh = Math.round(base(h.avgScored, a.avgConceded) + (gap > 0 ? abs / 40 : 0));
  let sa = Math.round(base(a.avgScored, h.avgConceded) + (gap < 0 ? abs / 40 : 0));
  sh = Math.max(0, Math.min(4, sh));
  sa = Math.max(0, Math.min(4, sa));
  const conf = Math.min(88, 45 + abs);
  const [hw, hd, hl] = d.h2h.summary;

  return [
    `**Mode secours — analyse TMP locale** (moteur IA momentanément indisponible, crédits épuisés).`,
    ``,
    `**1) Lecture TMP** — ${d.home.name} : ${h.tmp}/100 · ${d.away.name} : ${a.tmp}/100. Écart de ${abs} point(s) : ${lecture}.`,
    ``,
    `**2) Forme & tendances** — ${d.home.name} : ${h.wins}V·${h.draws}N·${h.losses}D, ${h.avgScored.toFixed(2)} but(s) marqués et ${h.avgConceded.toFixed(2)} encaissés par match, ${h.cleanSheets} clean sheet(s). ${d.away.name} : ${a.wins}V·${a.draws}N·${a.losses}D, ${a.avgScored.toFixed(2)} marqués et ${a.avgConceded.toFixed(2)} encaissés, ${a.cleanSheets} clean sheet(s).`,
    ``,
    `**3) Confrontations directes** — ${hw}V · ${hd}N · ${hl}D sur ${d.h2h.matches.length} rencontre(s) recensée(s).`,
    ``,
    `**4) Score exact projeté** — ${d.home.name} ${sh} - ${sa} ${d.away.name} · confiance ${conf}%.`,
  ].join("\n");
}