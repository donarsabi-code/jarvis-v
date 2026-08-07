import { createServerFn } from "@tanstack/react-start";

/** AI match analysis — gratuite et illimitée, sans compte. */
export const getAiMatchAnalysis = createServerFn({ method: "POST" })
  .inputValidator((matchId: string) => {
    if (!/^\d+$/.test(matchId)) throw new Error("Invalid match id");
    return matchId;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cached = await supabaseAdmin
      .from("ai_analyses")
      .select("content, created_at")
      .eq("match_id", data)
      .maybeSingle();

    if (cached.data && Date.now() - new Date(cached.data.created_at).getTime() < 6 * 3600_000) {
      return { content: cached.data.content, degraded: false as const };
    }

    const { fetchMatchDetails } = await import("./fotmob.server");
    const { analyseMatch } = await import("./jarvis-engine.server");
    const detail = await fetchMatchDetails(data);

    // Moteur JARVIS local: gratuit, illimité, aucun crédit consommé.
    const content = analyseMatch(detail).analysis;

    await supabaseAdmin
      .from("ai_analyses")
      .upsert({ match_id: data, content, created_at: new Date().toISOString() }, { onConflict: "match_id" });

    return { content, degraded: false as const };
  });

/** TMP duel: gratuit et illimité. */
export const getTmpDuel = createServerFn({ method: "POST" })
  .inputValidator((input: { home: string; away: string }) => {
    const home = input.home?.trim();
    const away = input.away?.trim();
    if (!home || !away) throw new Error("Deux équipes sont requises");
    return { home: home.slice(0, 60), away: away.slice(0, 60) };
  })
  .handler(async ({ data }) => {
    const { searchTeam, fetchTeamForm, teamLogo } = await import("./fotmob.server");
    const { analyseDuel } = await import("./jarvis-engine.server");

    const [h, a] = await Promise.all([searchTeam(data.home), searchTeam(data.away)]);
    if (!h || !a) {
      throw new Error(
        `Équipe introuvable: ${!h ? data.home : data.away}. Vérifiez l'orthographe du club.`,
      );
    }
    const [hf, af] = await Promise.all([
      fetchTeamForm(h.id, h.name).catch(() => null),
      fetchTeamForm(a.id, a.name).catch(() => null),
    ]);
    if (!hf || !af) throw new Error("Données de forme indisponibles pour l'une des équipes.");

    const result = analyseDuel(
      { name: h.name, stats: hf.stats, form: hf.form },
      { name: a.name, stats: af.stats, form: af.form },
    );

    return {
      ...result,
      homeName: h.name,
      awayName: a.name,
      homeLogo: teamLogo(h.id),
      awayLogo: teamLogo(a.id),
      homeForm: hf.form,
      awayForm: af.form,
    };
  });

/** Free conversation with JARVIS — sans compte. */
export const jarvisChat = createServerFn({ method: "POST" })
  .inputValidator((input: { messages: Array<{ role: "user" | "assistant"; content: string }> }) => {
    if (!Array.isArray(input.messages) || input.messages.length === 0) throw new Error("Message requis");
    return { messages: input.messages.slice(-12) };
  })
  .handler(async ({ data }) => {
    const { jarvisLocalReply } = await import("./jarvis-chat.server");
    const last = [...data.messages].reverse().find((m) => m.role === "user");
    const content = await jarvisLocalReply(last?.content ?? "");
    return { content };
  });

/** Manually trigger the daily prediction engine — accès libre. */
export const runPredictionEngine = createServerFn({ method: "POST" })
  .inputValidator((isoDate: string) => isoDate)
  .handler(async ({ data }) => {
    const { generateDailyPredictions } = await import("./predictions.server");
    return { predictions: await generateDailyPredictions(data) };
  });

/**
 * Rédaction IA (payante / limitée). Le calcul TMP reste gratuit et illimité :
 * cette fonction n'ajoute QUE le texte rédigé par le LLM et échoue proprement
 * quand les crédits sont épuisés.
 */
export const getAiNarrative = createServerFn({ method: "POST" })
  .inputValidator((input: { title: string; facts: string }) => {
    const title = input.title?.trim();
    const facts = input.facts?.trim();
    if (!title || !facts) throw new Error("Contexte manquant");
    return { title: title.slice(0, 120), facts: facts.slice(0, 4000) };
  })
  .handler(async ({ data }) => {
    const { askAI, JARVIS_SYSTEM } = await import("./ai.server");
    try {
      const text = await askAI([
        { role: "system", content: JARVIS_SYSTEM },
        {
          role: "user",
          content: `Rencontre : ${data.title}\n\nDonnées TMP déjà calculées (ne les contredis pas, ne change pas le score exact) :\n${data.facts}\n\nRédige en français, style JARVIS, 5 à 8 phrases : lecture de la dynamique, points de bascule, risques, et confirmation du score exact retenu.`,
        },
      ]);
      return { ok: true as const, text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ERROR";
      const reason =
        msg === "NO_CREDITS" ? ("NO_CREDITS" as const)
        : msg === "RATE_LIMIT" ? ("RATE_LIMIT" as const)
        : ("ERROR" as const);
      return { ok: false as const, reason };
    }
  });