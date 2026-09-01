import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getMatchDetail } from "@/lib/football.functions";
import { getAiMatchAnalysis } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Bot, CalendarDays, MapPin, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AiNarrative } from "@/components/AiNarrative";

const logo = (id: number) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

const detailQuery = (matchId: string) =>
  queryOptions({
    queryKey: ["match", matchId],
    queryFn: () => getMatchDetail({ data: matchId }),
    refetchInterval: 60_000,
  });

export const Route = createFileRoute("/match/$matchId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(detailQuery(params.matchId)),
  head: ({ loaderData }) => {
    const title = loaderData
      ? `${loaderData.home.name} - ${loaderData.away.name} : analyse & pronostic`
      : "Fiche de match";
    const description = loaderData
      ? `${loaderData.home.name} contre ${loaderData.away.name} (${loaderData.league}) : forme, confrontations directes, stats et analyse IA TMP.`
      : "Forme, confrontations directes, statistiques et analyse IA du match.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: MatchPage,
  errorComponent: () => (
    <main className="mx-auto max-w-3xl px-4 py-12 text-center">
      <p className="panel p-6 text-sm text-muted-foreground">Ce match n'a pas pu être chargé.</p>
    </main>
  ),
});

function MatchPage() {
  const { matchId } = Route.useParams();
  const { data } = useQuery(detailQuery(matchId));
  if (!data) return null;

  const kickoff = data.kickoff ? new Date(data.kickoff) : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <section className="hero-surface panel p-6">
        <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
          {data.league}
          {data.round ? ` · Journée ${data.round}` : ""}
        </p>
        <div className="mt-4 grid grid-cols-3 items-center gap-2">
          <TeamHead id={data.home.id} name={data.home.name} tmp={data.stats.home.tmp} />
          <div className="text-center">
            {data.started ? (
              <p className="text-3xl font-bold tabular-nums">
                {data.score.home ?? 0} - {data.score.away ?? 0}
              </p>
            ) : (
              <p className="text-2xl font-bold tabular-nums">
                {kickoff?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) ?? "--:--"}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {data.finished ? "Terminé" : data.started ? "En cours" : "À venir"}
            </p>
          </div>
          <TeamHead id={data.away.id} name={data.away.name} tmp={data.stats.away.tmp} />
        </div>

        <div className="mt-5 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <Info icon={<CalendarDays className="size-3.5" />} text={kickoff?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) ?? "—"} />
          <Info icon={<MapPin className="size-3.5" />} text={data.stadium ? `${data.stadium}${data.city ? `, ${data.city}` : ""}` : "Stade non communiqué"} />
          <Info icon={<UserCheck className="size-3.5" />} text={data.referee ? `Arbitre : ${data.referee}` : "Arbitre non communiqué"} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <FormCard title={`Forme — ${data.home.name}`} form={data.form.home} stats={data.stats.home} team={data.home.name} />
        <FormCard title={`Forme — ${data.away.name}`} form={data.form.away} stats={data.stats.away} team={data.away.name} />
      </div>

      <section className="panel mt-4 p-5">
        <h2 className="mb-3 text-sm font-semibold">Confrontations directes</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {data.h2h.matches.length} rencontres analysées · {data.h2h.summary[0]}V · {data.h2h.summary[1]}N ·{" "}
          {data.h2h.summary[2]}D
        </p>
        <ul className="space-y-1.5 text-sm">
          {data.h2h.matches.map((m, i) => (
            <li key={i} className="flex items-center gap-2 border-b border-border/50 pb-1.5 last:border-0">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">
                {m.date ? new Date(m.date).toLocaleDateString("fr-FR", { month: "2-digit", year: "2-digit", timeZone: "Europe/Paris" }) : ""}
              </span>
              <span className="min-w-0 flex-1 truncate">{m.home}</span>
              <span className="font-semibold tabular-nums">{m.score}</span>
              <span className="min-w-0 flex-1 truncate text-right">{m.away}</span>
            </li>
          ))}
        </ul>
      </section>

      <AiSection
        matchId={matchId}
        title={`${data.home.name} - ${data.away.name}`}
        minute={data.live?.minute ?? null}
        ongoing={data.live?.ongoing ?? false}
      />
    </main>
  );
}

function Info({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center justify-center gap-1.5 rounded-md bg-secondary/50 px-2 py-1.5 text-center">
      {icon}
      {text}
    </span>
  );
}

function TeamHead({ id, name, tmp }: { id: number; name: string; tmp: number }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <img src={logo(id)} alt={`Logo ${name}`} className="size-14 object-contain" />
      <p className="text-sm font-semibold leading-tight">{name}</p>
      <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] text-muted-foreground">
        TMP <span className="font-bold text-primary">{tmp}</span>
      </span>
    </div>
  );
}

type Stats = {
  wins: number; draws: number; losses: number; avgScored: number; avgConceded: number;
  scoredInAll: boolean; cleanSheets: number; tmp: number;
};

function FormCard({
  title,
  form,
  stats,
  team,
}: {
  title: string;
  form: Array<{ result: string; score: string; home: string; away: string }>;
  stats: Stats;
  team: string;
}) {
  return (
    <section className="panel p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="mb-3 flex gap-1.5">
        {form.map((f, i) => (
          <span
            key={i}
            title={`${f.home} ${f.score} ${f.away}`}
            className={`flex size-7 items-center justify-center rounded-md text-xs font-bold ${
              f.result === "W"
                ? "bg-success/20 text-success"
                : f.result === "D"
                  ? "bg-muted text-muted-foreground"
                  : "bg-destructive/20 text-destructive"
            }`}
          >
            {f.result}
          </span>
        ))}
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>
          Bilan sur 5 matchs : <strong className="text-foreground">{stats.wins}V · {stats.draws}N · {stats.losses}D</strong>
        </li>
        <li>
          Moyenne de buts : <strong className="text-foreground">{stats.avgScored}</strong> marqués ·{" "}
          <strong className="text-foreground">{stats.avgConceded}</strong> encaissés
        </li>
        <li>{stats.cleanSheets} clean sheet(s) sur les 5 dernières rencontres</li>
        <li>{stats.scoredInAll ? `${team} a marqué lors des 5 derniers matchs` : `${team} est resté muet au moins une fois`}</li>
        <li>
          Momentum TMP : <strong className="text-primary">{stats.tmp}/100</strong>
        </li>
      </ul>
    </section>
  );
}

function AiSection({
  matchId,
  title,
  minute,
  ongoing,
}: {
  matchId: string;
  title: string;
  minute: number | null;
  ongoing: boolean;
}) {
  const run = useServerFn(getAiMatchAnalysis);
  const [content, setContent] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const analyse = async () => {
    setLoading(true);
    try {
      const res = await run({ data: matchId });
      if (res.locked) {
        setLocked(res.message);
        setContent(null);
      } else {
        setLocked(null);
        setContent(res.content);
      }
    } catch {
      toast.error("Données du match indisponibles pour le moment.");
    } finally {
      setLoading(false);
    }
  };

  // Déclenchement automatique côté serveur dès la 15e minute, puis
  // réévaluation continue tant que le match est en cours.
  const busy = useRef(false);
  useEffect(() => {
    if (!ongoing || minute === null || minute < 15) return;
    if (busy.current) return;
    busy.current = true;
    void analyse().finally(() => {
      busy.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ongoing, minute, matchId]);

  return (
    <section className="panel glow mt-4 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4 text-primary" /> Analyse IA 🤖
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Dès la 15ᵉ minute, l'analyse se lance automatiquement côté serveur : 6 derniers matchs de
        championnat, classement, enjeu, H2H et vibration en direct (xG, tirs, possession). Gratuit et
        illimité, sans inscription.
      </p>

      {content ? (
        <>
          <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
          <AiNarrative title={title} facts={content} />
        </>
      ) : (
        <>
          {locked ? (
            <p className="mt-4 rounded-md border border-primary/30 bg-secondary/40 p-3 text-sm leading-relaxed text-muted-foreground">
              {locked}
            </p>
          ) : null}
          <Button className="mt-4" onClick={() => void analyse()} disabled={loading}>
            {loading ? "JARVIS analyse…" : locked ? "Réessayer l'analyse" : "Lancer l'analyse TMP"}
          </Button>
        </>
      )}
    </section>
  );
}