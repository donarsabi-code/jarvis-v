/** Cerveau conversationnel JARVIS local — gratuit, illimité, sans crédit IA. */
import { fetchMatchesByDate, fetchTeamForm, searchTeam } from "./fotmob.server";
import { analyseDuel } from "./jarvis-engine.server";

const HELLO = /\b(bonjour|salut|hello|bonsoir|coucou|hey)\b/i;
const TMP_Q = /\b(tmp|team momentum|comment.*calcul|méthode|methode)\b/i;
const TODAY_Q = /\b(aujourd|du jour|ce soir|matchs?|programme|top ?3|pronostic|prédiction|prediction)\b/i;
const HELP_Q = /\b(aide|help|que peux[- ]tu|capacité|fonctionne)\b/i;

const SPLIT = /\s(?:vs\.?|contre|-|–|contre le|face à)\s/i;

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function duelReply(home: string, away: string): Promise<string | null> {
  const [h, a] = await Promise.all([searchTeam(home), searchTeam(away)]);
  if (!h || !a) return null;
  const [hf, af] = await Promise.all([
    fetchTeamForm(h.id, h.name).catch(() => null),
    fetchTeamForm(a.id, a.name).catch(() => null),
  ]);
  if (!hf || !af) return null;
  const res = analyseDuel(
    { name: h.name, stats: hf.stats, form: hf.form },
    { name: a.name, stats: af.stats, form: af.form },
  );
  return res.analysis;
}

async function todayReply(): Promise<string> {
  const iso = today();
  const leagues = await fetchMatchesByDate(iso.replace(/-/g, "")).catch(() => []);
  const rows = leagues
    .flatMap((l) => l.matches.map((m) => ({ league: l.name, m })))
    .slice(0, 8)
    .map(
      (r) =>
        `• ${r.m.home} – ${r.m.away} (${r.league}${r.m.utcTime ? `, ${r.m.utcTime.slice(11, 16)} UTC` : ""})`,
    );
  if (!rows.length) return `Monsieur, aucun match exploitable n'est remonté pour le ${iso}.`;
  return [
    `Monsieur, voici la sélection du ${iso} :`,
    ...rows,
    ``,
    `Les 6 pronostics de score exact du jour sont consolidés sur la page **Pronostics**. Donnez-moi deux équipes (« Arsenal contre Chelsea ») et je lance immédiatement le duel TMP complet.`,
  ].join("\n");
}

export async function jarvisLocalReply(message: string): Promise<string> {
  const text = message.trim();

  const parts = text.split(SPLIT);
  if (parts.length === 2) {
    const home = parts[0]!.replace(/^.*?(?:analyse|duel|pronostic|score)\s*(?:de|pour|sur)?\s*/i, "").trim();
    const away = parts[1]!.replace(/[?.!].*$/, "").trim();
    if (home.length > 1 && away.length > 1) {
      const reply = await duelReply(home, away).catch(() => null);
      if (reply) return reply;
      return `Monsieur, je n'ai pas pu identifier « ${home} » ou « ${away} » dans la base FotMob. Précisez le nom exact du club.`;
    }
  }

  if (TMP_Q.test(text)) {
    return [
      `Monsieur, le **TMP (Team Momentum Performance)** est mon indicateur d'élan, noté sur 100.`,
      ``,
      `Il pondère les 5 derniers matchs (le plus récent pèse le plus) sur cinq axes : points obtenus (46 %), différence de buts (30 %), puissance offensive (10 %), solidité défensive (9 %) et clean sheets (5 %).`,
      ``,
      `Lecture : écart supérieur à 25 points → domination nette ; entre 10 et 25 → avantage marqué ; en dessous de 10 → match serré, le nul devient crédible.`,
      ``,
      `Le TMP alimente ensuite un modèle de Poisson pondéré (avantage du terrain, correction H2H) qui convertit l'élan en **score exact** et en niveau de confiance. Tout est calculé localement : gratuit et illimité.`,
    ].join("\n");
  }

  if (TODAY_Q.test(text)) return todayReply();

  if (HELLO.test(text) && text.length < 40) {
    return `Monsieur. Systèmes opérationnels, moteur TMP en ligne. Donnez-moi deux équipes et je vous livre le score exact, ou demandez-moi le programme du jour.`;
  }

  if (HELP_Q.test(text)) {
    return [
      `Monsieur, mes fonctions actives :`,
      `• **Duel TMP** — « Arsenal contre Chelsea » : TMP des deux équipes, probabilités, score exact et confiance.`,
      `• **Programme du jour** — « les matchs d'aujourd'hui ».`,
      `• **Méthodologie** — « comment calcules-tu le TMP ? ».`,
      `• **Analyse de match** — ouvrez une fiche de match, l'analyse complète s'y génère.`,
      ``,
      `Le tout gratuitement et sans limite de requêtes.`,
    ].join("\n");
  }

  return [
    `Monsieur, je traite exclusivement l'analyse footballistique par la méthode TMP.`,
    ``,
    `Formulez votre demande ainsi : « **Real Madrid contre Barcelone** » et je vous livre instantanément la lecture TMP, les probabilités et le score exact. Vous pouvez aussi me demander le programme du jour ou la méthodologie TMP.`,
  ].join("\n");
}