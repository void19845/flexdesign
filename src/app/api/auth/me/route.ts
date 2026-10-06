import { json, requireStaff, route } from "@/lib/server/http";
import type { Me } from "@/lib/shared/types";

/** Compte connecté et son rôle (401 si personne n'est connecté, 403 s'il n'a plus de rôle dans Flexdesign). */
export const GET = route(async (req) => {
  const { email, role } = await requireStaff(req);
  const me: Me = { email, role };
  return json(me);
});
