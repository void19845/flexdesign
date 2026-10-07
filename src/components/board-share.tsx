"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { api, isSessionError, post } from "@/lib/client/api";
import { MAX_BOARD_DESCRIPTION_LENGTH, MAX_BOARD_TITLE_LENGTH, type Board, type BoardMember, type TeamMember } from "@/lib/shared/types";

// Origine du site : lue dans le navigateur seulement (chaîne vide au rendu serveur), elle ne change pas
const noSubscribe = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";

/** Réglages et partage d'un moodboard (propriétaire seulement) : titre, équipe en lecture, membres, lien public. */
export function BoardShare({ board, onBoardChange, onAuthError }: { board: Board; onBoardChange: (board: Board) => void; onAuthError: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsDone, setSettingsDone] = useState("");

  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [pick, setPick] = useState("");
  const [pickEdit, setPickEdit] = useState(false);
  const [membersBusy, setMembersBusy] = useState(false);
  const [membersError, setMembersError] = useState("");

  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [linkDone, setLinkDone] = useState("");
  const origin = useSyncExternalStore(noSubscribe, browserOrigin, serverOrigin);
  const linkPath = board.shareToken ? `/m/${board.shareToken}` : "";

  function fail(err: unknown, show: (message: string) => void): void {
    if (isSessionError(err)) onAuthError(err.message);
    else show((err as Error).message);
  }

  useEffect(() => {
    let ignore = false;
    api<TeamMember[]>("/api/team")
      .then((t) => {
        if (!ignore) setTeam(t);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        if (isSessionError(err)) onAuthError(err.message);
        else setMembersError((err as Error).message);
      });
    return () => {
      ignore = true;
    };
  }, [onAuthError]);

  const candidates = (team ?? []).filter((t) => t.email !== board.ownerEmail && !board.members.some((m) => m.userId === t.userId));

  async function saveSettings(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const description = String(data.get("description") ?? "").trim();
    const teamRead = data.get("teamRead") === "on";
    setSaving(true);
    setSettingsError("");
    setSettingsDone("");
    try {
      await post("/api/boards/settings", { id: board.id, title, description, teamRead });
      onBoardChange({ ...board, title, description, teamRead });
      setSettingsDone("Réglages enregistrés.");
    } catch (err) {
      fail(err, setSettingsError);
    }
    setSaving(false);
  }

  /** Ajoute un membre ou change son accès (même route) ; renvoie false en cas d'échec. */
  async function setMember(userId: string, canEdit: boolean): Promise<boolean> {
    setMembersBusy(true);
    setMembersError("");
    let ok = false;
    try {
      const members = await post<BoardMember[]>("/api/boards/members", { boardId: board.id, userId, canEdit });
      onBoardChange({ ...board, members });
      ok = true;
    } catch (err) {
      fail(err, setMembersError);
    }
    setMembersBusy(false);
    return ok;
  }

  async function share(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (pick && (await setMember(pick, pickEdit))) setPick("");
  }

  async function removeMember(member: BoardMember): Promise<void> {
    setMembersBusy(true);
    setMembersError("");
    try {
      const members = await post<BoardMember[]>("/api/boards/members", { boardId: board.id, userId: member.userId }, "DELETE");
      onBoardChange({ ...board, members });
    } catch (err) {
      fail(err, setMembersError);
    }
    setMembersBusy(false);
  }

  async function createLink(): Promise<void> {
    if (board.shareToken && !window.confirm("Régénérer le lien ? L'ancien lien cessera de fonctionner.")) return;
    setLinkBusy(true);
    setLinkError("");
    setLinkDone("");
    try {
      const { token } = await post<{ token: string }>("/api/boards/link", { boardId: board.id });
      onBoardChange({ ...board, shareToken: token });
    } catch (err) {
      fail(err, setLinkError);
    }
    setLinkBusy(false);
  }

  async function deleteLink(): Promise<void> {
    if (!window.confirm("Désactiver le lien public ? Il cessera de fonctionner.")) return;
    setLinkBusy(true);
    setLinkError("");
    setLinkDone("");
    try {
      await post("/api/boards/link", { boardId: board.id }, "DELETE");
      onBoardChange({ ...board, shareToken: null });
    } catch (err) {
      fail(err, setLinkError);
    }
    setLinkBusy(false);
  }

  async function copyLink(): Promise<void> {
    setLinkError("");
    setLinkDone("");
    try {
      await navigator.clipboard.writeText(window.location.origin + linkPath);
      setLinkDone("Lien copié.");
    } catch {
      setLinkError("Copie impossible : sélectionnez le lien et copiez-le à la main.");
    }
  }

  return (
    <div className="board-share">
      <form className="card" onSubmit={saveSettings}>
        <h3>Réglages</h3>
        <label className="field">
          <span>Titre</span>
          <input name="title" type="text" defaultValue={board.title} maxLength={MAX_BOARD_TITLE_LENGTH} required />
        </label>
        <label className="field">
          <span>Description (facultative)</span>
          <textarea name="description" rows={2} defaultValue={board.description} maxLength={MAX_BOARD_DESCRIPTION_LENGTH} />
        </label>
        <label className="check">
          <input name="teamRead" type="checkbox" defaultChecked={board.teamRead} />
          Toute l&apos;équipe Flexdesign peut le voir (lecture seule)
        </label>
        <p className="error" role="alert">
          {settingsError}
        </p>
        {settingsDone && <p className="muted small">{settingsDone}</p>}
        <button type="submit" className="btn primary small" disabled={saving}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>

      <section className="card">
        <h3>Membres</h3>
        {board.members.length === 0 ? (
          <p className="muted small">Partagé avec personne pour l&apos;instant.</p>
        ) : (
          <ul className="share-members">
            {board.members.map((m) => (
              <li key={m.userId}>
                <span className="share-email">{m.email ?? "ancien membre"}</span>
                <select
                  value={m.canEdit ? "edit" : "read"}
                  onChange={(e) => void setMember(m.userId, e.currentTarget.value === "edit")}
                  disabled={membersBusy}
                  aria-label={`Accès de ${m.email ?? "ancien membre"}`}
                >
                  <option value="read">Lecture</option>
                  <option value="edit">Modification</option>
                </select>
                <button type="button" className="btn ghost small" onClick={() => void removeMember(m)} disabled={membersBusy}>
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
        {team === null ? (
          !membersError && <p className="muted small">Chargement de l&apos;équipe…</p>
        ) : candidates.length === 0 ? (
          <p className="muted small">Personne d&apos;autre dans l&apos;équipe avec qui partager.</p>
        ) : (
          <form className="share-add" onSubmit={share}>
            <select value={pick} onChange={(e) => setPick(e.currentTarget.value)} aria-label="Membre de l'équipe" required>
              <option value="">Choisir un membre</option>
              {candidates.map((t) => (
                <option key={t.userId} value={t.userId}>
                  {t.email}
                </option>
              ))}
            </select>
            <select value={pickEdit ? "edit" : "read"} onChange={(e) => setPickEdit(e.currentTarget.value === "edit")} aria-label="Accès">
              <option value="read">Lecture</option>
              <option value="edit">Modification</option>
            </select>
            <button type="submit" className="btn primary small" disabled={membersBusy || !pick}>
              Partager
            </button>
          </form>
        )}
        <p className="error" role="alert">
          {membersError}
        </p>
      </section>

      <section className="card">
        <h3>Lien public</h3>
        <p className="muted small">Lecture seule : toute personne qui a le lien peut voir ce moodboard, sans compte.</p>
        {board.shareToken === null ? (
          <button type="button" className="btn primary small" onClick={() => void createLink()} disabled={linkBusy}>
            Créer un lien public
          </button>
        ) : (
          <>
            <p className="share-link">{origin + linkPath}</p>
            <div className="share-actions">
              <button type="button" className="btn primary small" onClick={() => void copyLink()}>
                Copier le lien
              </button>
              <button type="button" className="btn ghost small" onClick={() => void createLink()} disabled={linkBusy}>
                Régénérer
              </button>
              <button type="button" className="btn ghost small danger-text" onClick={() => void deleteLink()} disabled={linkBusy}>
                Désactiver
              </button>
            </div>
          </>
        )}
        {linkDone && <p className="muted small">{linkDone}</p>}
        <p className="error" role="alert">
          {linkError}
        </p>
      </section>
    </div>
  );
}
