"use client";

import { useEffect, useState } from "react";
import { HomePanel } from "@/components/home-panel";
import { LoginForm } from "@/components/login-form";
import { currentAccount } from "@/lib/client/account";
import type { Me } from "@/lib/shared/types";

/**
 * loading : en attente de /api/auth/me ; login : connexion, avec un message éventuel ; panel : accueil.
 * id change à chaque retour à la connexion : le formulaire est recréé (message affiché, bouton réactivé).
 */
type View = { name: "loading" } | { name: "login"; message: string; id: number } | { name: "panel"; me: Me };

function toLogin(message: string): (view: View) => View {
  return (view) => ({ name: "login", message, id: view.name === "login" ? view.id + 1 : 0 });
}

/** Flexdesign : connexion d'un compte admin ou staff de l'appli, puis accueil. */
export function DesignApp() {
  const [view, setView] = useState<View>({ name: "loading" });

  useEffect(() => {
    let ignore = false;
    currentAccount()
      .then((me) => {
        if (!ignore) setView(me ? { name: "panel", me } : toLogin(""));
      })
      .catch((err: unknown) => {
        if (!ignore) setView(toLogin((err as Error).message));
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (view.name === "loading") return null;
  if (view.name === "panel") return <HomePanel account={view.me} onSignedOut={(m) => setView(toLogin(m ?? ""))} />;
  return (
    <div className="narrow">
      <LoginForm key={view.id} message={view.message} onSignedIn={(me) => setView({ name: "panel", me })} />
    </div>
  );
}
