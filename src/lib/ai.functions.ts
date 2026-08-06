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
      return { content: cached.data.content };
    }

    const { fetchMatchDetails } = await import("./fotmob.server");
    const { askAI, JARVIS_SYSTEM } = await import("./ai.server");
    const detail = await fetchMatchDetails(data);

    const content = await askAI([
      { role: "system", content: JARVIS_SYSTEM },
      {
        role: "user",
        content:
          `Rédige l'analyse IA complète de ce match en français (markdown léger, 250 mots max).\n` +
          `Sections: 1) Lecture TMP des deux équipes 2) Forme & tendances 3) Confrontations directes 4) Score exact prédit + confiance.\n` +
          `Données: ${JSON.stringify(detail)}`,
      },
    ]);

    await supabaseAdmin
      .from("ai_analyses")
      .upsert({ match_id: data, content, created_at: new Date().toISOString() }, { onConflict: "match_id" });

    return { content };
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
    const { askAIJson, JARVIS_SYSTEM } = await import("./ai.server");

    const [h, a] = await Promise.all([searchTeam(data.home), searchTeam(data.away)]);
    const [hf, af] = await Promise.all([
      h ? fetchTeamForm(h.id, h.name).catch(() => null) : null,
      a ? fetchTeamForm(a.id, a.name).catch(() => null) : null,
    ]);

    const result = await askAIJson<{
      tmpHome: number;
      tmpAway: number;
      home: number;
      away: number;
      confidence: number;
      analysis: string;
    }>([
      { role: "system", content: JARVIS_SYSTEM },
      {
        role: "user",
        content:
          `Duel TMP demandé: ${h?.name ?? data.home} (domicile) contre ${a?.name ?? data.away} (extérieur).\n` +
          `Données de forme récupérées: ${JSON.stringify({ domicile: hf, exterieur: af })}\n` +
          `Calcule le TMP (0-100) de chaque équipe selon la méthodologie Betclan, puis donne le SCORE EXACT.\n` +
          `JSON strict: {"tmpHome":number,"tmpAway":number,"home":number,"away":number,"confidence":number,"analysis":"analyse en français, 180 mots max, style JARVIS, avec la lecture TMP chiffrée"}`,
      },
    ]);

    return {
      ...result,
      homeName: h?.name ?? data.home,
      awayName: a?.name ?? data.away,
      homeLogo: h ? teamLogo(h.id) : null,
      awayLogo: a ? teamLogo(a.id) : null,
      homeForm: hf?.form ?? [],
      awayForm: af?.form ?? [],
    };
  });

/** Free conversation with JARVIS — sans compte. */
export const jarvisChat = createServerFn({ method: "POST" })
  .inputValidator((input: { messages: Array<{ role: "user" | "assistant"; content: string }> }) => {
    if (!Array.isArray(input.messages) || input.messages.length === 0) throw new Error("Message requis");
    return { messages: input.messages.slice(-12) };
  })
  .handler(async ({ data }) => {
    const { askAI, JARVIS_SYSTEM } = await import("./ai.server");
    const today = new Date().toISOString().slice(0, 10);
    const content = await askAI([
      {
        role: "system",
        content: `${JARVIS_SYSTEM}\nNous sommes le ${today}. Réponses courtes et utiles (150 mots max) sauf demande contraire.`,
      },
      ...data.messages,
    ]);
    return { content };
  });

/** Manually trigger the daily prediction engine — accès libre. */
export const runPredictionEngine = createServerFn({ method: "POST" })
  .inputValidator((isoDate: string) => isoDate)
  .handler(async ({ data }) => {
    const { generateDailyPredictions } = await import("./predictions.server");
    return { predictions: await generateDailyPredictions(data) };
  });