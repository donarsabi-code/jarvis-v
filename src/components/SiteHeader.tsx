import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Activity, LogOut } from "lucide-react";

export function SiteHeader() {
  const { user, openAuth, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-secondary glow">
            <Activity className="size-5 text-primary" />
          </span>
          <span className="text-base font-bold tracking-tight">
            Football<span className="text-gradient">Score IA</span>
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 text-sm sm:flex">
          <NavLink to="/">Matchs</NavLink>
          <NavLink to="/predictions">Prédictions du jour</NavLink>
          <NavLink to="/duel-tmp">Duel TMP</NavLink>
          <NavLink to="/jarvis">JARVIS</NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:block">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut className="size-4" />
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={openAuth} className="font-semibold">
              S'inscrire — gratuit
            </Button>
          )}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2 text-sm sm:hidden">
        <NavLink to="/">Matchs</NavLink>
        <NavLink to="/predictions">Prédictions</NavLink>
        <NavLink to="/duel-tmp">Duel TMP</NavLink>
        <NavLink to="/jarvis">JARVIS</NavLink>
      </nav>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="whitespace-nowrap rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      activeProps={{ className: "bg-secondary text-foreground" }}
    >
      {children}
    </Link>
  );
}