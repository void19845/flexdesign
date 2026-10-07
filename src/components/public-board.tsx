"use client";

import { useEffect, useState } from "react";
import { BoardCanvas, ZoomControls } from "@/components/board-canvas";
import { ApiError, api } from "@/lib/client/api";
import type { PublicBoard as Board } from "@/lib/shared/types";

/** Moodboard ouvert par lien public : lecture seule, aucune donnée de l'équipe. */
export function PublicBoard({ token }: { token: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(0.5);

  useEffect(() => {
    let ignore = false;
    api<Board>(`/api/public/board?token=${encodeURIComponent(token)}`)
      .then((b) => {
        if (!ignore) setBoard(b);
      })
      .catch((err: unknown) => {
        if (!ignore) setError(err instanceof ApiError && err.status === 404 ? "Ce lien n'existe pas ou a été désactivé." : (err as Error).message);
      });
    return () => {
      ignore = true;
    };
  }, [token]);

  if (!board) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div>
      <h1 className="board-public-title">{board.title}</h1>
      {board.description && <p className="board-text">{board.description}</p>}
      <p className="muted small">Moodboard partagé en lecture seule depuis Flexdesign</p>
      <div className="board-toolbar">
        <ZoomControls zoom={zoom} onZoom={setZoom} />
        {board.items.length === 0 && <span className="muted small">Aucune image pour l&apos;instant.</span>}
      </div>
      <BoardCanvas items={board.items} zoom={zoom} editable={false} selectedId={null} onSelect={() => {}} onItemChange={() => {}} />
    </div>
  );
}
