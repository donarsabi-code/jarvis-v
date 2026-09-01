import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
} as const;

/**
 * Balayage serveur : chaque match en cours ayant dépassé la 15e minute
 * voit son analyse recalculée et stockée automatiquement (moteur local,
 * aucun crédit IA consommé).
 */
export const Route = createFileRoute("/api/public/hooks/live-analysis")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        if (!key || key !== process.env['SUPABASE_PUBLISHABLE_KEY']) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
        try {
          const { fetchMatchesByDate, fetchMatchDetails } = await import("@/lib/fotmob.server");
          const { analyseLiveMatch, checkLiveGate } = await import("@/lib/jarvis-live.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const date = new Date().toISOString().slice(0, 10);
          const leagues = await fetchMatchesByDate(date);
          const live = leagues
            .flatMap((l) => l.matches)
            .filter((m: any) => m.started && !m.finished)
            .slice(0, 25);

          let updated = 0;
          for (const m of live) {
            try {
              const detail = await fetchMatchDetails(String(m.id));
              if (!checkLiveGate(detail).ready) continue;
              const content = analyseLiveMatch(detail).analysis;
              await supabaseAdmin.from("ai_analyses").upsert(
                { match_id: String(m.id), content, created_at: new Date().toISOString() },
                { onConflict: "match_id" },
              );
              updated += 1;
            } catch {
              /* match ignoré */
            }
          }

          return new Response(JSON.stringify({ ok: true, date, scanned: live.length, updated }), {
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          console.error(e);
          return new Response(JSON.stringify({ ok: false, error: String(e) }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});
