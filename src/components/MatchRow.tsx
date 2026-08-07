import { Link } from "@tanstack/react-router";

export type RowMatch = {
  id: string;
  home: string;
  away: string;
  homeId: number;
  awayId: number;
  homeScore: number | null;
  awayScore: number | null;
  utcTime: string | null;
  statusShort: string | null;
  started: boolean;
  finished: boolean;
  cancelled: boolean;
};

const logo = (id: number) =>
  `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

export function MatchRow({ match }: { match: RowMatch }) {
  const time = match.utcTime
    ? new Date(match.utcTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })
    : "--:--";
  const live = match.started && !match.finished && !match.cancelled;

  return (
    <Link
      to="/match/$matchId"
      params={{ matchId: match.id }}
      className="flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-0 hover:bg-secondary/60"
    >
      <div className="w-14 shrink-0 text-center">
        {live ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
            <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
            LIVE
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            {match.finished ? "FT" : match.cancelled ? "ANN." : time}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <TeamLine name={match.home} id={match.homeId} score={match.homeScore} />
        <TeamLine name={match.away} id={match.awayId} score={match.awayScore} />
      </div>
    </Link>
  );
}

function TeamLine({ name, id, score }: { name: string; id: number; score: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <img src={logo(id)} alt={`Logo ${name}`} loading="lazy" className="size-5 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <span className="w-5 text-right text-sm font-semibold tabular-nums">{score ?? ""}</span>
    </div>
  );
}