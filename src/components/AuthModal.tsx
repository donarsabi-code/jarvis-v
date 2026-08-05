import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import { useState } from "react";
import { toast } from "sonner";
import { Bot, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function AuthModal() {
  const { authOpen, closeAuth } = useAuth();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Connexion impossible. Réessayez.");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    setBusy(false);
    closeAuth();
  };

  return (
    <Dialog open={authOpen} onOpenChange={(o) => !o && closeAuth()}>
      <DialogContent className="panel max-w-md border-border">
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-secondary">
            <Bot className="size-6 text-primary" />
          </div>
          <DialogTitle className="text-2xl">Débloquez l'Analyse IA</DialogTitle>
          <DialogDescription>
            Forme, H2H, stats, blessés et tendances — analysés par JARVIS via la méthode TMP.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <Sparkles className="size-4 shrink-0 text-accent" /> Scores exacts et niveau de confiance
          </li>
          <li className="flex gap-2">
            <Sparkles className="size-4 shrink-0 text-accent" /> Duel TMP entre deux équipes de votre choix
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="size-4 shrink-0 text-primary" /> Accès 100 % gratuit après inscription
          </li>
        </ul>

        <Button onClick={signIn} disabled={busy} size="lg" className="mt-2 w-full font-semibold">
          <GoogleIcon />
          {busy ? "Ouverture…" : "Continue with Google"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Aucune carte bancaire. Vous pouvez vous déconnecter à tout moment.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.2 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C39.9 35.7 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}