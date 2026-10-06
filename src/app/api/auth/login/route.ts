import { HttpError, json, readJson, route, signIn, str } from "@/lib/server/http";
import { MAX_EMAIL_LENGTH } from "@/lib/shared/types";

/** Connexion : { email, password } -> Me. Refusée sans cookie si le compte n'a pas de rôle dans Flexdesign. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = str(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) throw new HttpError(400, "E-mail et mot de passe requis");
  if (email.length > MAX_EMAIL_LENGTH) throw new HttpError(400, "Adresse e-mail invalide.");
  return json(await signIn(req, email, password));
});
