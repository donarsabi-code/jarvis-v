import { createServerFn } from "@tanstack/react-start";

/**
 * Analyse JARVIS — gratuite et illimitée, sans compte.
 * Règle absolue : l'analyse n'est calculée et stockée qu'à partir de la
 * 14,5ᵉ minute de jeu. Avant ce seuil, les données sont collectées mais
 * aucune prédiction n'est émise. Une fois calculée, elle est figée.
 */
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

    const { fetchMatchDetails } = await import("./fotmob.server");
    const { analyseMatch, liveMinuteOf, LIVE_THRESHOLD } = await import("./jarvis-engine.server");
    const detail = await fetchMatchDetails(data);
    const minute = liveMinuteOf(detail);

    // Prédiction unique : figée dès qu'elle a été calculée.
    if (cached.data) {
      return { content: cached.data.content, locked: false as const, minute, message: null, degraded: false as const };
    }

    if (minute == null || minute < LIVE_THRESHOLD) {
      const played = minute == null ? "Le coup d'envoi n'a pas encore été donné" : `Nous en sommes à la ${minute}ᵉ minute`;
      return {
        content: null,
        locked: true as const,
        minute,
        message:
          `Cher Monsieur, je me nomme JARVIS, créé par l'architecte JORDAN. ${played}. ` +
          `Je collecte en ce moment même le direct, les 6 derniers matchs de championnat de chaque équipe, leurs 6 confrontations directes, l'enjeu et la gestion du rythme dans leur championnat. ` +
          `Veuillez patienter jusqu'à la 14,5ᵉ minute de jeu, puis revenir lancer l'analyse : je vous livrerai alors la lecture complète et la prédiction de score exact.`,
        degraded: false as const,
      };
    }

    // Moteur JARVIS local : gratuit, illimité, aucun crédit consommé.
    // Fusion passé (forme championnat, H2H, classement, enjeu) + présent
    // (direct relevé jusqu'à la minute courante), projeté sur 90 minutes.
    const content = analyseMatch(detail).analysis;

    await supabaseAdmin
      .from("ai_analyses")
      .upsert({ match_id: data, content, created_at: new Date().toISOString() }, { onConflict: "match_id" });

    return { content, locked: false as const, minute, message: null, degraded: false as const };
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
