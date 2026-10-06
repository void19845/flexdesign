/**
 * Test de bout en bout de Flexdesign (routes HTTP), contre la base LOCALE de la suite et l'appli lancée en local.
 * Utilise les comptes de test de flexstaff (TEST_* dans .env). Donne puis retire un rôle flexdesign au compte staff.
 *
 *   node --env-file=.env scripts/e2e.mjs [adresse, défaut http://localhost:8788]
 */
const APP = process.argv[2] ?? "http://localhost:8788";
const { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = process.env;
if (!SB?.includes("127.0.0.1") && !SB?.includes("localhost")) {
  console.error("Refusé : SUPABASE_URL ne pointe pas vers une base locale.");
  process.exit(1);
}
const env = process.env;

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? ` -> ${detail}` : ""}`);
}

/** Client HTTP avec ses propres cookies, comme un navigateur. */
function browser() {
  const jar = new Map();
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(APP + path, {
      method,
      headers: { "Content-Type": "application/json", cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      if (/Max-Age=0/.test(c)) jar.delete(k);
      else jar.set(k, v.join("="));
    }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
    return { status: res.status, data, cookies: jar.size };
  };
}

const admin = (path, init) => fetch(`${SB}${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...init?.headers } });

async function userId(email) {
  const { users } = await (await admin("/auth/v1/admin/users?per_page=200")).json();
  return users.find((x) => x.email === email)?.id;
}

const setRole = (id, role) =>
  admin("/rest/v1/app_roles?on_conflict=user_id,app", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: id, app: "flexdesign", role }) });
const removeRole = (id) => admin(`/rest/v1/app_roles?user_id=eq.${id}&app=eq.flexdesign`, { method: "DELETE" });

const login = async (who, email, password) => who("/api/auth/login", { method: "POST", body: { email, password } });

const staffId = await userId(env.TEST_STAFF_EMAIL);
if (!staffId) {
  console.error("Comptes de test absents : les créer avec npm run role dans flexstaff.");
  process.exit(1);
}
await removeRole(staffId);

console.log("\n# Connexion");
check("visiteur ne peut pas lire /api/auth/me", (await browser()("/api/auth/me")).status === 401);
check("mauvais mot de passe refusé", (await login(browser(), env.TEST_SUPER_EMAIL, "nope")).status === 401);
const formAdmin = await login(browser(), env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);
check("admin Flexform (sans rôle flexdesign) ne peut pas se connecter, sans cookie", formAdmin.status === 403 && formAdmin.cookies === 0, `${formAdmin.status}`);
const folioAdmin = await login(browser(), env.TEST_FOLIO_EMAIL, env.TEST_FOLIO_PASSWORD);
check("admin Flexfolio (sans rôle flexdesign) ne peut pas se connecter, sans cookie", folioAdmin.status === 403 && folioAdmin.cookies === 0, `${folioAdmin.status}`);

const superAdmin = browser();
const r1 = await login(superAdmin, env.TEST_SUPER_EMAIL, env.TEST_SUPER_PASSWORD);
check("super admin connecté en admin", r1.status === 200 && r1.data.role === "admin", JSON.stringify(r1.data));
check("/api/auth/me du super admin", (await superAdmin("/api/auth/me")).data.email === env.TEST_SUPER_EMAIL);
await superAdmin("/api/auth/logout", { method: "POST" });
check("après déconnexion : 401", (await superAdmin("/api/auth/me")).status === 401);

console.log("\n# Rôle retiré");
await setRole(staffId, "staff");
const staff = browser();
const r2 = await login(staff, env.TEST_STAFF_EMAIL, env.TEST_STAFF_PASSWORD);
check("staff Flexdesign connecté en staff", r2.status === 200 && r2.data.role === "staff", JSON.stringify(r2.data));
await removeRole(staffId);
check("rôle retiré : staff ne peut plus lire /api/auth/me à la requête suivante", (await staff("/api/auth/me")).status === 403);

console.log(`\n${failures ? `${failures} échec(s)` : "Tout est passé."}`);
process.exit(failures ? 1 : 0);
