import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
} as const;

export const Route = createFileRoute("/api/public/hooks/daily-predictions")({
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
          const { generateDailyPredictions } = await import("@/lib/predictions.server");
          const date = new Date().toISOString().slice(0, 10);
          const predictions = await generateDailyPredictions(date);
          return new Response(JSON.stringify({ ok: true, date, count: predictions.length }), {
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