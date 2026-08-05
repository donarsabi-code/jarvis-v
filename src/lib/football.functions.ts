import { createServerFn } from "@tanstack/react-start";

export const getMatchesByDate = createServerFn({ method: "GET" })
  .inputValidator((date: string) => {
    if (!/^\d{8}$/.test(date)) throw new Error("Invalid date");
    return date;
  })
  .handler(async ({ data }) => {
    const { fetchMatchesByDate } = await import("./fotmob.server");
    try {
      return { leagues: await fetchMatchesByDate(data), error: null as string | null };
    } catch {
      return { leagues: [], error: "Données indisponibles pour le moment." };
    }
  });

export const getMatchDetail = createServerFn({ method: "GET" })
  .inputValidator((matchId: string) => {
    if (!/^\d+$/.test(matchId)) throw new Error("Invalid match id");
    return matchId;
  })
  .handler(async ({ data }) => {
    const { fetchMatchDetails } = await import("./fotmob.server");
    return fetchMatchDetails(data);
  });

export const getDailyPredictions = createServerFn({ method: "GET" })
  .inputValidator((date: string) => date)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("daily_predictions")
      .select("*")
      .eq("match_date", data)
      .order("confidence", { ascending: false });
    return rows ?? [];
  });