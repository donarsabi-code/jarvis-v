import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { getMatchesByDate } from "@/lib/football.functions";
import { MatchRow } from "@/components/MatchRow";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Radio, Sparkles } from "lucide-react";

const todayIso = () => new Date().toISOString().slice(0, 10);
const compact = (iso: string) => iso.replace(/-/g, "");
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const matchesQuery = (iso: string) =>
  queryOptions({
    queryKey: ["matches", iso],
    queryFn: () => getMatchesByDate({ data: compact(iso) }),
    refetchInterval: 45_000,
  });

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { d?: string } => {
    const d = search['d'];
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { d } : {};
  },
  loaderDeps: ({ search }) => ({ d: search.d }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(matchesQuery(deps.d ?? todayIso())),
  head: () => ({
    meta: [
      { title: "Matchs du jour & scores en direct — FootballScore IA" },
      {
        name: "description",
        content:
          "Tous les matchs du jour par compétition, scores en direct, heures de coup d'envoi et analyses IA basées sur le classement TMP.",
      },
      { property: "og:title", content: "Matchs du jour & scores en direct" },
      {
        property: "og:description",
        content: "Scores en direct et analyses IA TMP pour chaque match de la journée.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const search = Route.useSearch();
  const iso = search.d ?? todayIso();
  const { data, isFetching } = useQuery(matchesQuery(iso));

  const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const leagues = data?.leagues ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <section className="hero-surface panel mb-6 overflow-hidden p-6 sm:p-8">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">
          <Radio className="size-3.5 text-primary" /> Données en direct · rafraîchies toutes les 45 s
        </p>
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Les matchs du jour, lus par <span className="text-gradient">JARVIS</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Scores en direct, fiches complètes (stade, arbitre, forme, H2H) et prédictions de score exact
          calculées sur le TMP — Team Momentum Performance ranking.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to="/predictions">
              <Sparkles className="size-4" /> Les 6 prédictions du jour
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link to="/duel-tmp">Duel TMP entre deux équipes</Link>
          </Button>
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/" search={{ d: shift(iso, -1) }} aria-label="Jour précédent">
            <ChevronLeft className="size-4" />
          </Link>
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold capitalize">{label}</p>
          <p className="text-xs text-muted-foreground">
            {isFetching ? "Actualisation…" : `${leagues.reduce((n, l) => n + l.matches.length, 0)} matchs`}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/" search={{ d: shift(iso, 1) }} aria-label="Jour suivant">
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      {data?.error ? (
        <p className="panel p-6 text-center text-sm text-muted-foreground">{data.error}</p>
      ) : leagues.length === 0 ? (
        <p className="panel p-6 text-center text-sm text-muted-foreground">Aucun match pour cette date.</p>
      ) : (
        <div className="space-y-4">
          {leagues.map((league) => (
            <section key={`${league.id}-${league.name}`} className="panel overflow-hidden">
              <header className="flex items-center gap-2 border-b border-border/70 bg-secondary/40 px-4 py-2.5">
                <img
                  src={`https://images.fotmob.com/image_resources/logo/teamlogo/${league.ccode.toLowerCase()}.png`}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="size-4 rounded-sm object-contain"
                />
                <h2 className="text-sm font-semibold">{league.name}</h2>
                <span className="ml-auto text-xs text-muted-foreground">{league.ccode}</span>
              </header>
              {league.matches.map((m) => (
                <MatchRow key={m.id} match={m} />
              ))}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
