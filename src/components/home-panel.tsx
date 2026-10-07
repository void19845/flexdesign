"use client";

import { useEffect, useState } from "react";
import { BoardsPanel } from "@/components/boards-panel";
import { FontsPanel } from "@/components/fonts-panel";
import { ThemesPanel } from "@/components/themes-panel";
import { signOut } from "@/lib/client/account";
import { api, isAuthError } from "@/lib/client/api";
import type { Font, Me, Theme } from "@/lib/shared/types";

type Tab = "themes" | "boards" | "fonts";

/** Accueil du compte connecté : thèmes (lecture seule pour le staff), moodboards et polices (admin). Voir PLAN.md. */
export function HomePanel({ account, onSignedOut }: { account: Me; onSignedOut: (message?: string) => void }) {
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<Tab>("themes");
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [error, setError] = useState("");
  const isAdmin = account.role === "admin";

  useEffect(() => {
    let ignore = false;
    Promise.all([api<Theme[]>("/api/themes"), api<Font[]>("/api/fonts")])
      .then(([t, f]) => {
        if (ignore) return;
        setThemes(t);
        setFonts(f);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        if (isAuthError(err)) onSignedOut(err.message);
        else setError((err as Error).message);
      });
    return () => {
      ignore = true;
    };
  }, [onSignedOut]);

  function leave(): void {
    setPending(true);
    void signOut().then(() => onSignedOut());
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Flex Suite</p>
          <h1>Flexdesign</h1>
        </div>
        <div className="topbar-actions">
          <span className="muted small">{account.email}</span>
          <span className={`badge role-${account.role}`}>{account.role}</span>
          <button type="button" className="btn ghost small" onClick={leave} disabled={pending}>
            Se déconnecter
          </button>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        <button type="button" className="btn tab" role="tab" aria-selected={tab === "themes"} onClick={() => setTab("themes")}>
          Thèmes
        </button>
        <button type="button" className="btn tab" role="tab" aria-selected={tab === "boards"} onClick={() => setTab("boards")}>
          Moodboards
        </button>
        {isAdmin && (
          <button type="button" className="btn tab" role="tab" aria-selected={tab === "fonts"} onClick={() => setTab("fonts")}>
            Polices
          </button>
        )}
      </nav>
      <p className="error" role="alert">
        {error}
      </p>
      {themes === null ? (
        !error && <p className="muted">Chargement…</p>
      ) : (
        <>
          {/* Onglets gardés montés : un brouillon en cours n'est pas perdu en changeant d'onglet */}
          <div hidden={tab !== "themes"}>
            <ThemesPanel themes={themes} fonts={fonts} canEdit={isAdmin} onThemesChange={setThemes} onAuthError={onSignedOut} />
          </div>
          <div hidden={tab !== "boards"}>
            <BoardsPanel onAuthError={onSignedOut} />
          </div>
          {isAdmin && (
            <div hidden={tab !== "fonts"}>
              <FontsPanel fonts={fonts} onFontsChange={setFonts} onAuthError={onSignedOut} />
            </div>
          )}
        </>
      )}
    </>
  );
}
