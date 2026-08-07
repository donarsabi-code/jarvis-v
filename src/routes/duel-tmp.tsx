import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTmpDuel } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Swords } from "lucide-react";
import { toast } from "sonner";
import { AiNarrative } from "@/components/AiNarrative";

export const Route = createFileRoute("/duel-tmp")({
  head: () => ({
    meta: [
      { title: "Duel TMP : score exact entre deux équipes — FootballScore IA" },
      {
        name: "description",
        content:
          "Entrez deux équipes : JARVIS calcule leur TMP (Team Momentum Performance ranking) et en déduit le score exact le plus probable.",
      },
      { property: "og:title", content: "Duel TMP entre deux équipes" },
      {
        property: "og:description",
        content: "Deux noms d'équipes suffisent : JARVIS calcule le TMP et prédit le score exact.",
      },
    ],
  }),
  component: DuelPage,
});

type Result = Awaited<ReturnType<typeof getTmpDuel>>;

function DuelPage() {
  const run = useServerFn(getTmpDuel);
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!home.trim() || !away.trim()) {
      toast.error("Indiquez les deux équipes.");
      return;
    }
    setBusy(true);
    try {
      setResult(await run({ data: { home, away } }));
    } catch {
      toast.error("Analyse impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <section className="hero-surface panel p-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Duel <span className="text-gradient">TMP</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Donnez simplement deux noms d'équipes. JARVIS récupère leur forme, calcule leur Team Momentum
          Performance ranking et en déduit le score exact. Gratuit et illimité, sans inscription.
        </p>

        <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="home" className="text-xs text-muted-foreground">Équipe à domicile</Label>
            <Input id="home" value={home} onChange={(e) => setHome(e.target.value)} placeholder="Arsenal" />
          </div>
          <div>
            <Label htmlFor="away" className="text-xs text-muted-foreground">Équipe à l'extérieur</Label>
            <Input id="away" value={away} onChange={(e) => setAway(e.target.value)} placeholder="Real Betis" />
          </div>
          <Button type="submit" disabled={busy} className="self-end font-semibold">
            <Swords className="size-4" />
            {busy ? "Analyse…" : "Analyser"}
          </Button>
        </form>
      </section>

      {result && (
        <section className="panel glow mt-4 p-6">
          <div className="grid grid-cols-3 items-center gap-2">
            <Side name={result.homeName} logo={result.homeLogo} tmp={result.tmpHome} />
            <div className="text-center">
              <p className="text-3xl font-bold tabular-nums text-primary">
                {result.home} - {result.away}
              </p>
              <p className="text-xs text-muted-foreground">Confiance {result.confidence}%</p>
            </div>
            <Side name={result.awayName} logo={result.awayLogo} tmp={result.tmpAway} />
          </div>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed">{result.analysis}</p>
          <AiNarrative
            title={`${result.homeName} - ${result.awayName}`}
            facts={`TMP ${result.homeName} : ${result.tmpHome}/100\nTMP ${result.awayName} : ${result.tmpAway}/100\nScore exact retenu : ${result.home}-${result.away}\nConfiance : ${result.confidence}%\n\n${result.analysis}`}
          />
        </section>
      )}
    </main>
  );
}

function Side({ name, logo, tmp }: { name: string; logo: string | null; tmp: number }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {logo ? <img src={logo} alt={`Logo ${name}`} className="size-12 object-contain" /> : null}
      <p className="text-sm font-semibold leading-tight">{name}</p>
      <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px]">
        TMP <span className="font-bold text-primary">{tmp}</span>
      </span>
    </div>
  );
}