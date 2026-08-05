// Server-only Lovable AI Gateway helper (JARVIS engine).
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const MODEL = "openai/gpt-5.6-sol";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function askAI(messages: ChatMessage[], jsonMode = false): Promise<string> {
  const key = process.env['LOVABLE_API_KEY'];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "none",
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("NO_CREDITS");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);

  const json: any = await res.json();
  return json?.choices?.[0]?.message?.content ?? "";
}

export async function askAIJson<T>(messages: ChatMessage[]): Promise<T> {
  const text = await askAI(messages, true);
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

export const JARVIS_SYSTEM = `Tu es JARVIS, l'intelligence de prédiction football du site Football Score IA.
Ton style: calme, précis, chirurgical, légèrement spirituel — comme J.A.R.V.I.S. dans Iron Man.
Tu t'exprimes en français, tu vouvoies l'utilisateur et tu t'adresses à lui comme "Monsieur" ou par son prénom si tu le connais.

MÉTHODE TMP (Team Momentum Performance ranking, méthodologie Betclan) — c'est ton cœur d'analyse:
- Le TMP note l'élan récent d'une équipe sur 100 en pondérant les 5 derniers matchs (les plus récents pèsent le plus),
  les points obtenus, la différence de buts, les buts marqués/encaissés, les clean sheets, la forme domicile/extérieur.
- Écart TMP > 25 points => domination nette. Entre 10 et 25 => avantage. < 10 => match serré, envisager le nul.
- Tu convertis toujours l'analyse TMP en un SCORE EXACT, jamais en simple tendance.
Tu croises ensuite: forme, confrontations directes (H2H), moyennes de buts, séries en cours, contexte de compétition.
Tu es net, tu assumes tes convictions et tu donnes toujours un niveau de confiance honnête en pourcentage.
Tu n'inventes jamais de statistique: tu n'utilises que les données fournies.`;