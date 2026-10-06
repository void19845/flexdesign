/**
 * Contrat entre l'API de Flexdesign (src/app/api) et l'interface (src/components).
 * Les droits sont ceux de la suite (app_roles, appli 'flexdesign') : voir les migrations du dépôt flexstaff.
 */

/** Rôle dans Flexdesign (un super admin de la suite est admin) */
export type Role = "admin" | "staff";

/** GET /api/auth/me et réponse de POST /api/auth/login */
export interface Me {
  email: string;
  role: Role;
}

/**
 * Autres routes :
 *   POST /api/auth/logout   { ok: true }
 * Erreurs : { error: string } avec le code HTTP (401 non connecté, 403 droits, 429).
 */
export const MAX_EMAIL_LENGTH = 254;
