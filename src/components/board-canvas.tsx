"use client";

import { useRef, type PointerEvent, type Ref } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH, MAX_ITEM_WIDTH, MIN_ITEM_WIDTH, type BoardItem } from "@/lib/shared/types";

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1];

type Patch = Partial<Pick<BoardItem, "x" | "y" | "w" | "z">>;

/** Geste en cours : départ du pointeur et image telle qu'au début du geste */
interface Gesture {
  item: BoardItem;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  moved: boolean;
  patch: Patch;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Boutons de zoom, par paliers de ZOOM_STEPS. */
export function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const index = ZOOM_STEPS.indexOf(zoom);
  return (
    <span className="zoom-controls">
      <button type="button" className="btn ghost small" onClick={() => onZoom(ZOOM_STEPS[index - 1])} disabled={index <= 0}>
        Zoom arrière
      </button>
      <span className="zoom-value" aria-live="polite">{`${Math.round(zoom * 100)} %`}</span>
      <button
        type="button"
        className="btn ghost small"
        onClick={() => onZoom(ZOOM_STEPS[index + 1])}
        disabled={index >= ZOOM_STEPS.length - 1}
      >
        Zoom avant
      </button>
      <button type="button" className="btn ghost small" onClick={() => onZoom(1)} disabled={zoom === 1}>
        100 %
      </button>
    </span>
  );
}

/**
 * Toile libre d'un moodboard : positions en pixels logiques, affichées multipliées par zoom.
 * Modifiable : glisser une image la déplace, la poignée en bas à droite la redimensionne ;
 * onItemChange reçoit done=false pendant le geste et done=true une seule fois à la fin.
 * ref donne accès à la zone qui défile (position visible pour placer les nouvelles images).
 */
export function BoardCanvas({
  items,
  zoom,
  editable,
  selectedId,
  onSelect,
  onItemChange,
  ref,
}: {
  items: BoardItem[];
  zoom: number;
  editable: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onItemChange: (id: string, patch: Patch, done: boolean) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const gesture = useRef<Gesture | null>(null);

  function start(e: PointerEvent<HTMLDivElement>, item: BoardItem): void {
    onSelect(item.id);
    if (!editable || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode = (e.target as HTMLElement).classList.contains("board-resize") ? "resize" : "move";
    gesture.current = { item, mode, startX: e.clientX, startY: e.clientY, moved: false, patch: {} };
  }

  function move(e: PointerEvent<HTMLDivElement>): void {
    const g = gesture.current;
    if (!g) return;
    // Un clic qui tremble de quelques pixels n'est pas un déplacement
    if (!g.moved && Math.abs(e.clientX - g.startX) + Math.abs(e.clientY - g.startY) < 4) return;
    g.moved = true;
    const dx = (e.clientX - g.startX) / zoom;
    const dy = (e.clientY - g.startY) / zoom;
    const ratio = g.item.heightPx / g.item.widthPx;
    if (g.mode === "move") {
      g.patch = {
        x: clamp(Math.round(g.item.x + dx), 0, Math.max(0, CANVAS_WIDTH - g.item.w)),
        y: clamp(Math.round(g.item.y + dy), 0, Math.max(0, CANVAS_HEIGHT - Math.round(g.item.w * ratio))),
      };
    } else {
      // L'image reste dans la toile
      const max = Math.max(MIN_ITEM_WIDTH, Math.min(MAX_ITEM_WIDTH, CANVAS_WIDTH - g.item.x, Math.floor((CANVAS_HEIGHT - g.item.y) / ratio)));
      g.patch = { w: clamp(Math.round(g.item.w + dx), MIN_ITEM_WIDTH, max) };
    }
    onItemChange(g.item.id, g.patch, false);
  }

  function end(): void {
    const g = gesture.current;
    gesture.current = null;
    if (g?.moved) onItemChange(g.item.id, g.patch, true);
  }

  return (
    <div className="board-viewport" ref={ref}>
      <div
        className="board-stage"
        style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom, backgroundSize: `${40 * zoom}px ${40 * zoom}px` }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <div
              key={item.id}
              className={`board-item${editable ? " editable" : ""}${selected ? " selected" : ""}`}
              style={{ left: item.x * zoom, top: item.y * zoom, width: item.w * zoom, zIndex: item.z }}
              tabIndex={0}
              onFocus={() => onSelect(item.id)}
              onPointerDown={(e) => start(e, item)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              <div className="board-frame">
                {/* Image servie par une route /api du même site, aux dimensions déjà connues : pas besoin de next/image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={item.note || "Image du moodboard"}
                  width={Math.round(item.w * zoom)}
                  height={Math.round(((item.w * item.heightPx) / item.widthPx) * zoom)}
                  draggable={false}
                  loading="lazy"
                />
                {editable && selected && <span className="board-resize" aria-hidden="true" />}
              </div>
              {item.note && <p className="board-caption">{item.note}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
