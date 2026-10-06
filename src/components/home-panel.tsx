"use client";

import { useState } from "react";
import { signOut } from "@/lib/client/account";
import type { Me } from "@/lib/shared/types";

/** Accueil du compte connecté. Les outils (design system, studio, moodboards) viendront ici : voir PLAN.md. */
export function HomePanel({ account, onSignedOut }: { account: Me; onSignedOut: () => void }) {
  const [pending, setPending] = useState(false);

  function leave(): void {
    setPending(true);
    void signOut().then(onSignedOut);
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
      <section className="card">
        <h2>En construction</h2>
        <p className="muted">Le design system, le studio de visuels et les moodboards arrivent ici.</p>
      </section>
    </>
  );
}
