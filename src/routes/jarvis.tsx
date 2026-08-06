import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { jarvisChat } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Send } from "lucide-react";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Donne-moi tes 3 scores exacts les plus sûrs aujourd'hui",
  "Explique-moi comment tu calcules le TMP",
  "Compare la dynamique du PSG et de Marseille",
];

export const Route = createFileRoute("/jarvis")({
  head: () => ({
    meta: [
      { title: "Parler à JARVIS — l'IA football de FootballScore IA" },
      {
        name: "description",
        content:
          "Discutez avec JARVIS : analyses TMP, scores exacts, dynamiques d'équipes et lectures de matchs en temps réel.",
      },
      { property: "og:title", content: "Parler à JARVIS" },
      {
        property: "og:description",
        content: "L'IA football qui analyse le TMP et prédit les scores exacts, en conversation.",
      },
    ],
  }),
  component: JarvisPage,
});

function JarvisPage() {
  const send = useServerFn(jarvisChat);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Systèmes en ligne. Je suis JARVIS. Donnez-moi deux équipes, une date ou une question, et je vous livre une lecture TMP chiffrée avec un score exact.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await send({ data: { messages: next } });
      setMessages([...next, { role: "assistant", content: res.content }]);
    } catch {
      toast.error("JARVIS est momentanément indisponible.");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <section className="panel flex h-[70vh] flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border/70 bg-secondary/40 px-4 py-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-secondary glow">
            <Bot className="size-4 text-primary" />
          </span>
          <div>
            <h1 className="text-sm font-semibold">JARVIS</h1>
            <p className="text-[11px] text-muted-foreground">Moteur d'analyse TMP · en ligne</p>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground"
              }`}
            >
              {m.content}
            </div>
          ))}
          {busy && <p className="text-xs text-muted-foreground">JARVIS calcule…</p>}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border/70 p-3">
          <div className="mb-2 flex gap-2 overflow-x-auto">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void ask(s)}
                className="whitespace-nowrap rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) void ask(input.trim());
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question à JARVIS…"
              disabled={busy}
            />
            <Button type="submit" disabled={busy} aria-label="Envoyer">
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}