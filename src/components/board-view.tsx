"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { BoardCanvas, ZoomControls } from "@/components/board-canvas";
import { BoardShare } from "@/components/board-share";
import { api, isSessionError, post, postForm } from "@/lib/client/api";
import { prepareImage } from "@/lib/client/image";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_NOTE_LENGTH,
  MIN_ITEM_WIDTH,
  type Board,
  type BoardAccess,
  type BoardItem,
  type BoardSummary,
} from "@/lib/shared/types";

const ACCESS_LABELS: Record<BoardAccess, string> = { owner: "propriétaire", edit: "modification", read: "lecture seule" };
const EXTENSIONS: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };

function summary(b: Board): BoardSummary {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    ownerEmail: b.ownerEmail,
    access: b.access,
    teamRead: b.teamRead,
    itemCount: b.items.length,
    updatedAt: b.updatedAt,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Plus haut ordre d'empilement des autres images (-Infinity si aucune). */
function topZ(items: BoardItem[], exceptId: string): number {
  return Math.max(...items.filter((i) => i.id !== exceptId).map((i) => i.z));
}

/**
 * Un moodboard : toile, envoi d'images, note de l'image choisie, partage (propriétaire).
 * reload change pour relire le tableau depuis le serveur (après un échec d'enregistrement).
 */
export function BoardView({
  boardId,
  onClose,
  onBoardChange,
  onDeleted,
  onAuthError,
}: {
  boardId: string;
  onClose: () => void;
  onBoardChange: (board: BoardSummary) => void;
  onDeleted: (id: string) => void;
  onAuthError: (message: string) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [reload, setReload] = useState(0);
  const [zoom, setZoom] = useState(0.5);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [error, setError] = useState("");
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let ignore = false;
    api<Board>(`/api/boards/detail?id=${encodeURIComponent(boardId)}`)
      .then((b) => {
        if (!ignore) setBoard(b);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        if (isSessionError(err)) onAuthError(err.message);
        else setError((err as Error).message);
      });
    return () => {
      ignore = true;
    };
    // onAuthError n'est pas une raison de relire le tableau
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, reload]);

  function fail(err: unknown): void {
    if (isSessionError(err)) onAuthError(err.message);
    else setError((err as Error).message);
  }

  if (!board) {
    return (
      <div className="editor">
        <header className="editor-head">
          <h2>Moodboard</h2>
          <button type="button" className="btn ghost small" onClick={onClose}>
            Fermer
          </button>
        </header>
        <p className="error" role="alert">
          {error}
        </p>
        {!error && <p className="muted">Chargement...</p>}
      </div>
    );
  }

  const current = board;
  const canEdit = current.access !== "read";
  const isOwner = current.access === "owner";
  const selected = current.items.find((i) => i.id === selectedId) ?? null;
  const noteText = selected && note?.id === selected.id ? note.text : (selected?.note ?? "");

  function replaceItem(item: BoardItem): void {
    setBoard((b) => b && { ...b, items: b.items.map((i) => (i.id === item.id ? item : i)) });
  }

  /** Enregistre un changement d'image ; en cas d'échec, relit le tableau pour revenir à l'état du serveur. */
  async function saveItem(id: string, patch: Partial<BoardItem>): Promise<BoardItem | null> {
    setError("");
    try {
      return await post<BoardItem>("/api/boards/items/update", { id, ...patch });
    } catch (err) {
      fail(err);
      setReload((n) => n + 1);
      return null;
    }
  }

  /** Déplacement ou redimensionnement : l'image passe au premier plan, enregistrée à la fin du geste. */
  function itemChange(id: string, patch: Partial<Pick<BoardItem, "x" | "y" | "w" | "z">>, done: boolean): void {
    const item = current.items.find((i) => i.id === id);
    if (!item) return;
    const top = topZ(current.items, id);
    const z = item.z > top ? item.z : top + 1;
    setBoard((b) => b && { ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...patch, z } : i)) });
    if (done) void saveItem(id, { ...patch, z });
  }

  async function bringToFront(): Promise<void> {
    if (!selected) return;
    const top = topZ(current.items, selected.id);
    if (selected.z > top) return;
    const saved = await saveItem(selected.id, { z: top + 1 });
    if (saved) replaceItem(saved);
  }

  async function saveNote(): Promise<void> {
    if (!selected) return;
    setPending(true);
    setStatus("");
    const saved = await saveItem(selected.id, { note: noteText });
    if (saved) {
      replaceItem(saved);
      setNote(null);
      setStatus("Note enregistrée.");
    }
    setPending(false);
  }

  async function removeItem(): Promise<void> {
    if (!selected || !window.confirm("Supprimer cette image du moodboard ?")) return;
    const id = selected.id;
    setPending(true);
    setError("");
    try {
      await post("/api/boards/items", { id }, "DELETE");
      const next = { ...current, items: current.items.filter((i) => i.id !== id) };
      setBoard((b) => b && { ...b, items: b.items.filter((i) => i.id !== id) });
      setSelectedId(null);
      onBoardChange(summary(next));
    } catch (err) {
      fail(err);
    }
    setPending(false);
  }

  async function upload(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    // Nouvelles images en haut à gauche de la partie visible, décalées l'une après l'autre
    const left = (viewport.current?.scrollLeft ?? 0) / zoom;
    const top = (viewport.current?.scrollTop ?? 0) / zoom;
    const added: BoardItem[] = [];
    const errors: string[] = [];
    setPending(true);
    setError("");
    setUploadErrors([]);
    for (const [i, file] of files.entries()) {
      setStatus(`Envoi ${i + 1} / ${files.length}`);
      try {
        const image = await prepareImage(file);
        const w = Math.max(MIN_ITEM_WIDTH, Math.min(400, image.widthPx));
        const h = Math.round((w * image.heightPx) / image.widthPx);
        const form = new FormData();
        form.append("boardId", current.id);
        form.append("file", image.blob, `image.${EXTENSIONS[image.blob.type] ?? "jpg"}`);
        form.append("widthPx", String(image.widthPx));
        form.append("heightPx", String(image.heightPx));
        form.append("x", String(clamp(Math.round(left + 40 + i * 40), 0, Math.max(0, CANVAS_WIDTH - w))));
        form.append("y", String(clamp(Math.round(top + 40 + i * 40), 0, Math.max(0, CANVAS_HEIGHT - h))));
        form.append("w", String(w));
        const item = await postForm<BoardItem>("/api/boards/items", form);
        added.push(item);
        setBoard((b) => b && { ...b, items: [...b.items, item] });
      } catch (err) {
        if (isSessionError(err)) {
          onAuthError(err.message);
          return;
        }
        errors.push(`${file.name} : ${(err as Error).message}`);
      }
    }
    setUploadErrors(errors);
    setStatus(added.length ? `${added.length} image${added.length > 1 ? "s" : ""} ajoutée${added.length > 1 ? "s" : ""}.` : "");
    setPending(false);
    if (added.length) onBoardChange(summary({ ...current, items: [...current.items, ...added] }));
  }

  async function removeBoard(): Promise<void> {
    if (!window.confirm(`Supprimer le moodboard « ${current.title} » et toutes ses images ?`)) return;
    setPending(true);
    setError("");
    try {
      await post("/api/boards", { id: current.id }, "DELETE");
      onDeleted(current.id);
    } catch (err) {
      fail(err);
      setPending(false);
    }
  }

  function shareChange(next: Board): void {
    setBoard(next);
    onBoardChange(summary(next));
  }

  return (
    <div className="editor">
      <header className="editor-head">
        <div className="board-title">
          <h2>
            {current.title} <span className="badge">{ACCESS_LABELS[current.access]}</span>
          </h2>
          {current.description && <p className="muted board-text">{current.description}</p>}
          {!isOwner && <p className="muted small">{`Moodboard de ${current.ownerEmail ?? "un ancien membre de l'équipe"}`}</p>}
        </div>
        <div className="topbar-actions board-actions">
          {canEdit && (
            <>
              <button type="button" className="btn primary small" onClick={() => fileInput.current?.click()} disabled={pending}>
                Ajouter des images
              </button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={upload} />
            </>
          )}
          {isOwner && (
            <>
              <button type="button" className="btn small" onClick={() => setShareOpen((o) => !o)} aria-expanded={shareOpen}>
                Partager
              </button>
              <button type="button" className="btn ghost small danger-text" onClick={removeBoard} disabled={pending}>
                Supprimer le moodboard
              </button>
            </>
          )}
          <button type="button" className="btn ghost small" onClick={onClose}>
            Fermer
          </button>
        </div>
      </header>

      <p className="error" role="alert">
        {error}
      </p>
      {uploadErrors.length > 0 && (
        <ul className="error board-errors" role="alert">
          {uploadErrors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      <p className="muted small" role="status">
        {status}
      </p>

      {isOwner && shareOpen && (
        <section className="card board-share-panel">
          <BoardShare board={current} onBoardChange={shareChange} onAuthError={onAuthError} />
        </section>
      )}

      <div className="board-toolbar">
        <ZoomControls zoom={zoom} onZoom={setZoom} />
        {current.items.length === 0 && (
          <span className="muted small">{canEdit ? "Aucune image pour l'instant : ajoutez-en avec « Ajouter des images »." : "Aucune image pour l'instant."}</span>
        )}
      </div>

      <div className={`board-layout${selected ? " with-panel" : ""}`}>
        <BoardCanvas
          ref={viewport}
          items={current.items}
          zoom={zoom}
          editable={canEdit}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onItemChange={itemChange}
        />
        {selected && (
          <aside className="card board-panel">
            <h3>Image choisie</h3>
            {canEdit ? (
              <>
                <label className="field">
                  <span>Note</span>
                  <textarea
                    value={noteText}
                    maxLength={MAX_NOTE_LENGTH}
                    rows={4}
                    onChange={(e) => {
                      setNote({ id: selected.id, text: e.target.value });
                      setStatus("");
                    }}
                  />
                </label>
                <div className="board-panel-actions">
                  <button type="button" className="btn primary small" onClick={saveNote} disabled={pending || noteText === selected.note}>
                    Enregistrer la note
                  </button>
                  <button type="button" className="btn small" onClick={bringToFront} disabled={pending || selected.z > topZ(current.items, selected.id)}>
                    Mettre au premier plan
                  </button>
                  <button type="button" className="btn ghost small danger-text" onClick={removeItem} disabled={pending}>
                    {"Supprimer l'image"}
                  </button>
                </div>
              </>
            ) : (
              <p className={selected.note ? "board-note" : "muted"}>{selected.note || "Pas de note."}</p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
