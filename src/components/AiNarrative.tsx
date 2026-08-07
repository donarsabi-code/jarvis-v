import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAiNarrative } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

/**
 * Couche de rédaction IA (limitée par les crédits).
 * Le calcul TMP affiché au-dessus reste gratuit et illimité.
 */
export function AiNarrative({ title, facts }: { title: string; facts: string }) {
  const run = useServerFn(getAiNarrative);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await run({ data: { title, facts } });
      if (res.ok) setText(res.text);
      else
        setNote(
          res.reason === "NO_CREDITS"
            ? "Monsieur, la rédaction IA est momentanément indisponible : crédits épuisés. L'analyse TMP ci-dessus reste complète, gratuite et illimitée."
            : res.reason === "RATE_LIMIT"
              ? "Trop de requêtes de rédaction IA. Réessayez dans un instant — le calcul TMP reste disponible."
              : "La rédaction IA a échoué. Le calcul TMP reste disponible.",
        );
    } catch {
      setNote("La rédaction IA a échoué. Le calcul TMP reste disponible.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 border-t border-border/60 pt-4">
      {text ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
      ) : (
        <>
          <Button variant="outline" size="sm" onClick={() => void go()} disabled={busy}>
            <Sparkles className="size-4" />
            {busy ? "Rédaction IA…" : "Enrichir avec la rédaction IA"}
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Calcul TMP et score exact : gratuits et illimités. La rédaction IA est une couche
            optionnelle, soumise aux crédits.
          </p>
        </>
      )}
      {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
