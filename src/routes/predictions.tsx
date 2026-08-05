import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDailyPredictions } from "@/lib/football.functions";
import { runPredictionEngine } from "@/lib/ai.functions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sparkles, Target } from "lucide-react";
import { toast } from "sonner";

const todayIso = () => new Date().toISOString().slice(0, 10);

const predictionsQuery = (iso: string) =>
  queryOptions({
    queryKey: ["predictions", iso],
    queryFn: () => getDailyPredictions({ data: iso }),
  });

export const Route = createFileRoute("/predictions")({
  loader: ({ context }) => context.queryClient.ensureQueryData(predictionsQuery(todayIso())),
  head: () => ({
    meta: [
      { title: "Prédictions de score exact du jour — FootballScore IA" },
      {
        name: "description",
        content:
          "Les 6 prédictions de score exact du jour, générées automatiquement par JARVIS à partir du classement TMP et des données de forme.",
      },
      { property: "og:title", content: "Les 6 prédictions de score exact du jour" },
      {
        property: "og:description",
        content: "Scores exacts, TMP et niveau de confiance, générés chaque jour par l'IA JARVIS.",
      },
    ],
  }),
  component: PredictionsPage,
});

function PredictionsPage() {
  const iso = todayIso();
  const { data } = useQuery(predictionsQuery(iso));
  const { user, openAuth } = useAuth();
  const qc = useQueryClient();
  const run = useServerFn(runPredictionEngine);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!user) return openAuth();
    setBusy(true);
    try {
      await run({ data: iso });
      await qc.invalidateQueries({ queryKey: ["predictions", iso] });
      toast.success("JARVIS a publié ses prédictions du jour.");
    } catch {
      toast.error("Le moteur n'a pas pu générer les prédictions.");
    } finally {
      setBusy(false);
    }
  };

  const rows = data ?? [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <section className="hero-surface panel p-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Les <span className="text-gradient">6 prédictions</span> du jour
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Chaque jour, JARVIS sélectionne six affiches, calcule le TMP des deux équipes et publie un score
          exact avec son niveau de confiance.
        </p>
        <Button className="mt-4" onClick={() => void generate()} disabled={busy}>
          <Sparkles className="size-4" />
          {busy ? "Calcul en cours…" : rows.length ? "Recalculer maintenant" : "Générer les prédictions"}
        </Button>
      </section>

      {rows.length === 0 ? (
        <p className="panel mt-4 p-6 text-center text-sm text-muted-foreground">
          Aucune prédiction publiée pour aujourd'hui pour l'instant.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <article key={p.id} className="panel p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{p.league_name}</span>
                <span className="inline-flex items-center gap-1 text-accent">
                  <Target className="size-3.5" /> {p.confidence}%
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <img src={p.home_logo ?? ""} alt="" className="size-7 object-contain" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.home_team}</span>
                <span className="rounded-md bg-secondary px-2 py-1 text-base font-bold tabular-nums text-primary">
                  {p.predicted_home} - {p.predicted_away}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-sm font-medium">{p.away_team}</span>
                <img src={p.away_logo ?? ""} alt="" className="size-7 object-contain" />
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                TMP {p.tmp_home} vs {p.tmp_away}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.reasoning}</p>
              <Link
                to="/match/$matchId"
                params={{ matchId: p.match_id }}
                className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
              >
                Voir la fiche du match →
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}