import "server-only";

import { HttpError } from "./errors";
import { Db, dbErrorToHttp, serviceDb, supabaseConfig, userDb } from "./supabase";
import type { Me, Role } from "@/lib/shared/types";

export { HttpError };

// Session : jetons Supabase Auth dans des cookies HttpOnly (jamais lisibles par le JavaScript de la page).
// Noms propres à Flexdesign : en local, toutes les applis de la suite partagent les cookies de localhost.
const ACCESS_COOKIE = "fd_access";
const REFRESH_COOKIE = "fd_refresh";
const MAX_AGE = 7 * 24 * 3600;

type Handler = (req: Request) => Promise<Response>;

/** Cookies à ajouter à la réponse (ex. jeton rafraîchi pendant la requête). */
const pendingCookies = new WeakMap<Request, string[]>();

function addCookie(req: Request, cookie: string): void {
  pendingCookies.set(req, [...(pendingCookies.get(req) ?? []), cookie]);
}

/** Transforme les erreurs en réponses JSON propres et ajoute les cookies en attente. */
export function route(fn: Handler): Handler {
  return async (req) => {
    let res: Response;
    try {
      res = await fn(req);
    } catch (raw) {
      const err = dbErrorToHttp(raw);
      if (err instanceof HttpError) res = json({ error: err.message }, err.status);
      else {
        console.error(err);
        res = json({ error: "Erreur serveur" }, 500);
      }
    }
    for (const cookie of pendingCookies.get(req) ?? []) res.headers.append("Set-Cookie", cookie);
    return res;
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 10_000) throw new HttpError(413, "Requête trop volumineuse");
  try {
    const data: unknown = JSON.parse(text || "{}");
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON invalide");
  }
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookie(req: Request, name: string, value: string | null): string {
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const v = value ? `${name}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE}` : `${name}=; Max-Age=0`;
  return `${v}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Limite simple par IP, partagée entre toutes les fonctions via la base. */
export async function rateLimit(req: Request, bucket: string, max: number, windowSeconds = 60): Promise<void> {
  const n = await serviceDb().rpc<number>("suite_hit_rate_limit", { p_key: `flexdesign:${bucket}:${clientIp(req)}`, p_window_seconds: windowSeconds });
  if (n > max) throw new HttpError(429, "Trop de tentatives, réessaie dans une minute");
}

// --- Comptes (Supabase Auth) ----------------------------------------------

export interface AccountContext extends Me {
  /** Accès à la base avec le jeton du compte : la RLS décide */
  db: Db;
  userId: string;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** Contenu (non vérifié) du jeton. La vérification est faite par Supabase à chaque requête. */
function jwtPayload(token: string): { sub?: string; email?: string; exp?: number } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; email?: string; exp?: number };
  } catch {
    return {};
  }
}

async function authRequest(grant: "password" | "refresh_token", body: object): Promise<Tokens | null> {
  const cfg = supabaseConfig();
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return (await res.json()) as Tokens;
}

function setTokens(req: Request, tokens: Tokens | null): void {
  addCookie(req, cookie(req, ACCESS_COOKIE, tokens?.access_token ?? null));
  addCookie(req, cookie(req, REFRESH_COOKIE, tokens?.refresh_token ?? null));
}

/** Rôle du compte du jeton dans Flexdesign, lu dans la base (super admin = admin). */
async function roleOf(db: Db): Promise<Role | null> {
  const role = await db.rpc<string | null>("suite_app_role", { p_app: "flexdesign" });
  return role === "admin" || role === "staff" ? role : null;
}

const NO_ACCESS = "Ce compte n'a pas de rôle admin ou staff dans Flexdesign.";

/** Connexion. Refusée (sans cookie) si le compte n'a pas de rôle flexdesign dans app_roles. */
export async function signIn(req: Request, email: string, password: string): Promise<Me> {
  await rateLimit(req, "login", 10);
  const tokens = await authRequest("password", { email, password });
  if (!tokens) throw new HttpError(401, "E-mail ou mot de passe incorrect");
  const role = await roleOf(userDb(tokens.access_token));
  if (!role) throw new HttpError(403, NO_ACCESS);
  setTokens(req, tokens);
  return { email: jwtPayload(tokens.access_token).email ?? email, role };
}

export function signOut(req: Request): void {
  setTokens(req, null);
}

/**
 * Compte connecté avec un des rôles demandés. Le jeton est rafraîchi s'il expire bientôt.
 * Le rôle est relu dans la base à chaque requête : retirer son rôle dans app_roles lui coupe l'accès aussitôt.
 */
export async function requireRole(req: Request, roles: Role[]): Promise<AccountContext> {
  let access = readCookie(req, ACCESS_COOKIE);
  const refresh = readCookie(req, REFRESH_COOKIE);
  if (!access && !refresh) throw new HttpError(401, "Connecte-toi avec ton compte.");

  const exp = access ? (jwtPayload(access).exp ?? 0) : 0;
  if (!access || exp * 1000 < Date.now() + 30_000) {
    const tokens = refresh ? await authRequest("refresh_token", { refresh_token: refresh }) : null;
    if (!tokens) {
      signOut(req);
      throw new HttpError(401, "Session expirée, reconnecte-toi.");
    }
    setTokens(req, tokens);
    access = tokens.access_token;
  }

  const db = userDb(access);
  const role = await roleOf(db);
  if (!role || !roles.includes(role)) throw new HttpError(403, role ? "Ton compte n'a pas accès à cette action." : NO_ACCESS);
  const payload = jwtPayload(access);
  return { db, role, userId: payload.sub ?? "", email: payload.email ?? "" };
}

export const requireStaff = (req: Request): Promise<AccountContext> => requireRole(req, ["admin", "staff"]);
export const requireAdmin = (req: Request): Promise<AccountContext> => requireRole(req, ["admin"]);
