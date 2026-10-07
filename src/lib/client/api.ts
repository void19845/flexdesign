/** Appels à l'API de l'appli depuis le navigateur. Les sessions passent par des cookies HttpOnly. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Requête JSON ; lève ApiError avec le message d'erreur renvoyé par le serveur. */
export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  return data;
}

/** POST avec un corps JSON (raccourci). */
export function post<T = unknown>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** POST multipart (FormData) : sans Content-Type, le navigateur ajoute lui-même la frontière. */
export async function postForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  return data;
}

/**
 * Session refusée (401) seulement. Pour les moodboards, un 403 est souvent un simple refus (lecture seule,
 * réservé au propriétaire) : il s'affiche comme une erreur sans renvoyer à la connexion.
 */
export function isSessionError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 401;
}

/** Session refusée (401) ou accès retiré (403). */
export function isAuthError(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}
