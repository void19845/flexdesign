"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BoardView } from "@/components/board-view";
import { api, isAuthError, post } from "@/lib/client/api";
import { MAX_BOARD_DESCRIPTION_LENGTH, MAX_BOARD_TITLE_LENGTH, type BoardSummary } from "@/lib/shared/types";

/** Carte d'un moodboard dans la liste ; shared affiche le propriétaire et le niveau d'accès. */
function BoardCard({ board, shared, onOpen }: { board: BoardSummary; shared: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="theme-card board-card" onClick={onOpen}>
        <strong>{board.title}</strong>
        {board.description && <span className="board-description muted small">{board.description}</span>}
        <span className="muted small">
          {board.itemCount} image{board.itemCount > 1 ? "s" : ""}
          {shared && ` - ${board.ownerEmail ?? "ancien membre"}`}
        </span>
        <span className="board-badges">
          {shared && <span className="badge">{board.access === "edit" ? "modification" : "lecture"}</span>}
          {board.teamRead && <span className="badge">toute l&apos;équipe</span>}
        </span>
      </button>
    </li>
  );
}

/** Moodboards du compte : les siens et ceux partagés avec lui. n change à chaque ouverture : la vue repart de zéro. */
export function BoardsPanel({ onAuthError }: { onAuthError: (message: string) => void }) {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [open, setOpen] = useState<{ n: number; id: string } | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    let ignore = false;
    api<BoardSummary[]>("/api/boards")
      .then((b) => {
        if (!ignore) setBoards(b);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        if (isAuthError(err)) onAuthError(err.message);
        else setError((err as Error).message);
      });
    return () => {
      ignore = true;
    };
  }, [onAuthError]);

  function openBoard(id: string): void {
    setOpen((o) => ({ n: (o?.n ?? 0) + 1, id }));
  }

  async function create(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setCreateError("");
    try {
      const board = await post<BoardSummary>("/api/boards", {
        title: String(data.get("title") ?? "").trim(),
        description: String(data.get("description") ?? "").trim(),
      });
      setBoards((bs) => [board, ...(bs ?? [])]);
      form.reset();
      openBoard(board.id);
    } catch (err) {
      if (isAuthError(err)) onAuthError(err.message);
      else setCreateError((err as Error).message);
    }
    setCreating(false);
  }

  if (open) {
    return (
      <BoardView
        key={open.n}
        boardId={open.id}
        onClose={() => setOpen(null)}
        onBoardChange={(board) => setBoards((bs) => (bs ?? []).map((b) => (b.id === board.id ? board : b)))}
        onDeleted={(id) => {
          setBoards((bs) => (bs ?? []).filter((b) => b.id !== id));
          setOpen(null);
        }}
        onAuthError={onAuthError}
      />
    );
  }

  if (boards === null) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Chargement…</p>
    );
  }

  const mine = boards.filter((b) => b.access === "owner");
  const shared = boards.filter((b) => b.access !== "owner");

  return (
    <>
      <section className="board-section">
        <div className="section-head">
          <h2>Mes moodboards</h2>
        </div>
        {mine.length === 0 ? (
          <p className="card muted">Aucun moodboard pour l&apos;instant. Créez le premier ci-dessous.</p>
        ) : (
          <ul className="theme-list">
            {mine.map((b) => (
              <BoardCard key={b.id} board={b} shared={false} onOpen={() => openBoard(b.id)} />
            ))}
          </ul>
        )}
      </section>

      <form className="card board-section" onSubmit={create}>
        <h2>Nouveau moodboard</h2>
        <label className="field">
          <span>Titre</span>
          <input name="title" type="text" maxLength={MAX_BOARD_TITLE_LENGTH} required />
        </label>
        <label className="field">
          <span>Description (facultative)</span>
          <textarea name="description" rows={2} maxLength={MAX_BOARD_DESCRIPTION_LENGTH} />
        </label>
        <p className="error" role="alert">
          {createError}
        </p>
        <button type="submit" className="btn primary" disabled={creating}>
          {creating ? "Création..." : "Créer"}
        </button>
      </form>

      <section className="board-section">
        <div className="section-head">
          <h2>Partagés avec moi</h2>
        </div>
        {shared.length === 0 ? (
          <p className="card muted">Aucun moodboard partagé avec vous pour l&apos;instant.</p>
        ) : (
          <ul className="theme-list">
            {shared.map((b) => (
              <BoardCard key={b.id} board={b} shared onOpen={() => openBoard(b.id)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
