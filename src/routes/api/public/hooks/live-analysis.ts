import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
} as const;

/**
 * Balayage serveur : pré-calcule l'analyse historique (forme championnat,
 * classement, enjeu, H2H) des matchs du jour non encore analysés.
 * Moteur local uniquement, aucun crédit IA consommé, aucun score en direct.
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
          const { analyseMatch } = await import("@/lib/jarvis-engine.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const date = new Date().toISOString().slice(0, 10);
          const leagues = await fetchMatchesByDate(date);
          const todays = leagues
            .flatMap((l) => l.matches)
            .filter((m: any) => !m.finished)
            .slice(0, 25);

          const ids = todays.map((m: any) => String(m.id));
          const existing = await supabaseAdmin
            .from("ai_analyses")
            .select("match_id")
            .in("match_id", ids);
          const done = new Set((existing.data ?? []).map((r) => r.match_id));

          let updated = 0;
          for (const m of todays) {
            const id = String(m.id);
            if (done.has(id)) continue;
            try {
              const detail = await fetchMatchDetails(id);
              const content = analyseMatch(detail).analysis;
              await supabaseAdmin.from("ai_analyses").upsert(
                { match_id: id, content, created_at: new Date().toISOString() },
                { onConflict: "match_id" },
              );
              updated += 1;
            } catch {
              /* match ignoré */
            }
          }

          return new Response(JSON.stringify({ ok: true, date, scanned: todays.length, updated }), {
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
