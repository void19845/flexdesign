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
  return async (path, { method = "GET", body, form } = {}) => {
    const res = await fetch(APP + path, {
      method,
      // form : FormData envoyé en multipart (fetch choisit alors le Content-Type)
      headers: { ...(form ? {} : { "Content-Type": "application/json" }), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
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

/** Restes des tests : thèmes "e2e-...", polices envoyées "e2e-...", copie du catalogue abeezee, fichiers tentés par staff / anon. */
async function cleanup() {
  await admin("/rest/v1/design_themes?name=like.e2e-*", { method: "DELETE" });
  const fonts = await (await admin("/rest/v1/design_fonts?select=id,design_font_files(path)&or=(label.like.e2e-*,catalog_id.eq.abeezee)")).json();
  const paths = [...fonts.flatMap((f) => f.design_font_files.map((x) => x.path)), "e2e-staff.woff2", "e2e-anon.woff2"];
  await admin("/storage/v1/object/design-fonts", { method: "DELETE", body: JSON.stringify({ prefixes: paths }) });
  if (fonts.length) await admin(`/rest/v1/design_fonts?id=in.(${fonts.map((f) => f.id).join(",")})`, { method: "DELETE" });
}

/** Jeton Supabase d'un compte, pour interroger la base directement (prouve la RLS, pas seulement l'appli). */
async function token(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).access_token;
}

/** Appel direct à Supabase avec un jeton (par défaut la clé anon, comme un visiteur). */
const direct = (path, bearer, init = {}) =>
  fetch(`${SB}${path}`, { ...init, headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer ?? env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json", ...init.headers } });

const staffId = await userId(env.TEST_STAFF_EMAIL);
if (!staffId) {
  console.error("Comptes de test absents : les créer avec npm run role dans flexstaff.");
  process.exit(1);
}
await removeRole(staffId);
await cleanup();
// Le script se connecte plusieurs fois : compteur de tentatives remis à zéro (base locale uniquement)
await admin("/rest/v1/suite_rate_limits?key=like.flexdesign:login:*", { method: "DELETE" });

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

console.log("\n# Thèmes");
const visitor = browser();
check("visiteur ne peut pas lire /api/themes", (await visitor("/api/themes")).status === 401);
check("visiteur ne peut pas créer de thème", (await visitor("/api/themes", { method: "POST", body: { name: "e2e-visiteur" } })).status === 401);

await setRole(staffId, "staff"); // le navigateur staff garde sa session : le rôle est relu à chaque requête
await login(superAdmin, env.TEST_SUPER_EMAIL, env.TEST_SUPER_PASSWORD);

const light = { background: "#FFF", surface: "#f5f5f5", text: "#111111", muted: "#666666", border: "#dddddd", primary: "#5b21b6", onPrimary: "#ffffff", accent: "#f59e0b", onAccent: "#111111", success: "#15803d", warning: "#b45309", danger: "#b91c1c" };
const dark = { background: "#111111", surface: "#1e1e1e", text: "#eeeeee", muted: "#aaaaaa", border: "#333333", primary: "#a78bfa", onPrimary: "#111111", accent: "#fbbf24", onAccent: "#111111", success: "#4ade80", warning: "#fbbf24", danger: "#f87171" };
const themeBody = { name: "e2e-theme", hasDark: false, light, dark: null, named: [{ name: "corail", hex: "#FF7F50" }, { name: "bleu-nuit", hex: "#123" }], fonts: [] };

const staffList = await staff("/api/themes");
check("staff Flexdesign peut lire /api/themes", staffList.status === 200 && Array.isArray(staffList.data), `${staffList.status}`);
check("staff ne peut pas créer de thème", (await staff("/api/themes", { method: "POST", body: themeBody })).status === 403);

const created = await superAdmin("/api/themes", { method: "POST", body: themeBody });
const theme = created.data;
check("admin crée un thème (201)", created.status === 201 && typeof theme?.id === "string", `${created.status} ${JSON.stringify(created.data)}`);
check("#rgb enregistré en #rrggbb minuscules", theme?.light?.background === "#ffffff" && theme?.named?.find((c) => c.name === "bleu-nuit")?.hex === "#112233" && theme?.named?.find((c) => c.name === "corail")?.hex === "#ff7f50", JSON.stringify(theme?.light));
check("thème : 12 rôles clairs, 10 nuances dérivées, pas de sombre", Object.keys(theme?.light ?? {}).length === 12 && Object.keys(theme?.derived?.light ?? {}).length === 10 && theme?.dark === null && theme?.derived?.dark === null, JSON.stringify(theme?.derived));
check("staff ne peut pas supprimer de thème", (await staff("/api/themes", { method: "DELETE", body: { id: theme?.id } })).status === 403);

const bad = async (label, body, status = 400) => {
  const r = await superAdmin("/api/themes", { method: "POST", body: { ...themeBody, ...body } });
  check(label, r.status === status, `${r.status} ${JSON.stringify(r.data)}`);
};
await bad("couleur hexadécimale invalide refusée", { name: "e2e-bad", light: { ...light, text: "#12345" } });
const missing = { ...light };
delete missing.danger;
await bad("rôle de couleur manquant refusé", { name: "e2e-bad", light: missing });
await bad("nom de couleur nommée invalide refusé", { name: "e2e-bad", named: [{ name: "Bad Name", hex: "#000000" }] });
await bad("plus de 24 couleurs nommées refusées", { name: "e2e-bad", named: Array.from({ length: 25 }, (_, i) => ({ name: `c${i}`, hex: "#000000" })) });
await bad("nom de thème en double refusé", {}, 409);

const replaced = await superAdmin("/api/themes", { method: "POST", body: { ...themeBody, id: theme?.id, hasDark: true, dark } });
check("admin remplace le thème avec un mode sombre (200)", replaced.status === 200 && replaced.data.dark?.primary === "#a78bfa" && Object.keys(replaced.data.derived?.dark ?? {}).length === 10, `${replaced.status} ${JSON.stringify(replaced.data)}`);
const noDark = await superAdmin("/api/themes", { method: "POST", body: { ...themeBody, id: theme?.id, hasDark: false, dark } });
check("hasDark false retire le mode sombre", noDark.status === 200 && noDark.data.dark === null && noDark.data.derived?.dark === null, `${noDark.status} ${JSON.stringify(noDark.data)}`);

console.log("\n# Thèmes : base de données en direct (RLS)");
const staffToken = await token(env.TEST_STAFF_EMAIL, env.TEST_STAFF_PASSWORD);
const formToken = await token(env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);
const anonThemes = await direct(`/rest/v1/design_themes?select=id&id=eq.${theme?.id}`);
check("visiteur (anon) peut lire design_themes", anonThemes.status === 200 && (await anonThemes.json()).length === 1);
const anonColors = await direct(`/rest/v1/design_theme_colors?select=name&theme_id=eq.${theme?.id}`);
check("visiteur (anon) peut lire design_theme_colors", anonColors.status === 200 && (await anonColors.json()).length > 0);
check("visiteur (anon) ne peut pas écrire dans design_themes", (await direct("/rest/v1/design_themes", undefined, { method: "POST", body: JSON.stringify({ name: "e2e-anon" }) })).status >= 400);
check("staff ne peut pas écrire dans design_themes", (await direct("/rest/v1/design_themes", staffToken, { method: "POST", body: JSON.stringify({ name: "e2e-staff" }) })).status >= 400);
const patch = await direct(`/rest/v1/design_themes?id=eq.${theme?.id}`, staffToken, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "e2e-pirate" }) });
const patched = patch.status < 400 ? await patch.json() : [];
const [stillNamed] = await (await admin(`/rest/v1/design_themes?select=name&id=eq.${theme?.id}`)).json();
check("staff ne peut pas modifier un thème", patched.length === 0 && stillNamed?.name === "e2e-theme", `${patch.status} ${JSON.stringify(patched)}`);
const rpc = (bearer) => direct("/rest/v1/rpc/design_save_theme", bearer, { method: "POST", body: JSON.stringify({ p_theme: { name: "e2e-rpc", has_dark: false, colors: [], fonts: [] } }) });
const staffRpc = await rpc(staffToken);
check("staff ne peut pas appeler design_save_theme", staffRpc.status === 403, `${staffRpc.status} ${await staffRpc.text()}`);
const formRpc = await rpc(formToken);
check("admin Flexform (sans rôle flexdesign) ne peut pas appeler design_save_theme", formRpc.status === 403, `${formRpc.status} ${await formRpc.text()}`);

const del = await superAdmin("/api/themes", { method: "DELETE", body: { id: theme?.id } });
check("admin supprime le thème", del.status === 200, `${del.status} ${JSON.stringify(del.data)}`);
check("thème déjà supprimé : 404", (await superAdmin("/api/themes", { method: "DELETE", body: { id: theme?.id } })).status === 404);

console.log("\n# Polices");
const woff2 = (size = 1024) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x77, 0x4f, 0x46, 0x32]); // "wOF2"
  return new Blob([bytes], { type: "font/woff2" });
};
const fontForm = (fields, file = woff2()) => {
  const form = new FormData();
  if (file) form.append("file", file, "police.woff2");
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  return form;
};
const upload = (who, fields, file) => who("/api/fonts/upload", { method: "POST", form: fontForm(fields, file) });
const newFont = { label: "e2e-police", weight: 400, style: "normal", license: "on" };

check("staff ne peut pas envoyer de police", (await upload(staff, newFont)).status === 403);
check("staff ne peut pas supprimer de police", (await staff("/api/fonts", { method: "DELETE", body: { id: "00000000-0000-0000-0000-000000000000" } })).status === 403);
check("staff ne peut pas chercher dans le catalogue", (await staff("/api/fonts/catalog?q=abeezee")).status === 403);
check("staff Flexdesign peut lire /api/fonts", (await staff("/api/fonts")).status === 200);

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)])], { type: "font/woff2" });
const upBad = async (label, fields, file, status) => {
  const r = await upload(superAdmin, fields, file);
  check(label, r.status === status, `${r.status} ${JSON.stringify(r.data)}`);
};
await upBad("envoi refusé : premiers octets d'un PNG", newFont, png, 400);
await upBad("envoi refusé : case licence non cochée", { label: "e2e-police", weight: 400, style: "normal" }, woff2(), 400);
await upBad("envoi refusé : fichier de plus de 2 Mo", newFont, woff2(2 * 1024 * 1024 + 1), 413);
await upBad("envoi refusé : nom manquant pour une nouvelle police", { weight: 400, style: "normal", license: "on" }, woff2(), 400);

const up = await upload(superAdmin, newFont);
const font = up.data;
check("admin envoie une police woff2 (201)", up.status === 201 && typeof font?.id === "string", `${up.status} ${JSON.stringify(up.data)}`);
check("nom de famille généré, jamais le texte saisi", /^Flexdesign [0-9a-f]{8}$/.test(font?.family ?? "") && font?.label === "e2e-police", font?.family);
const fileUrl = font?.files?.[0]?.url ?? "";
check("fichier dans le bucket public design-fonts", fileUrl.includes("/storage/v1/object/public/design-fonts/"), fileUrl);
check("fichier de police téléchargeable", fileUrl !== "" && (await fetch(fileUrl)).status === 200);
const again = await upload(superAdmin, { fontId: font?.id, weight: 400, style: "normal", license: "on" });
check("même graisse et même style en double refusés (409)", again.status === 409, `${again.status} ${JSON.stringify(again.data)}`);
const bold = await upload(superAdmin, { fontId: font?.id, weight: 700, style: "normal", license: "on" });
check("ajout de la graisse 700 à la police (201, 2 fichiers)", bold.status === 201 && bold.data.files?.length === 2 && bold.data.family === font?.family, `${bold.status} ${JSON.stringify(bold.data)}`);

const storagePut = (bearer, name) => direct(`/storage/v1/object/design-fonts/${name}`, bearer, { method: "POST", headers: { "Content-Type": "font/woff2" }, body: woff2() });
const staffPut = await storagePut(staffToken, "e2e-staff.woff2");
check("staff ne peut pas déposer de fichier dans design-fonts", staffPut.status >= 400, `${staffPut.status}`);
const anonPut = await storagePut(undefined, "e2e-anon.woff2");
check("visiteur (anon) ne peut pas déposer de fichier dans design-fonts", anonPut.status >= 400, `${anonPut.status}`);

const fontTheme = await superAdmin("/api/themes", { method: "POST", body: { ...themeBody, name: "e2e-theme-police", fonts: [{ role: "body", fontId: font?.id, fallback: "sans-serif" }] } });
check("admin crée un thème avec la police envoyée", fontTheme.status === 201 && fontTheme.data.fonts?.[0]?.fontId === font?.id, `${fontTheme.status} ${JSON.stringify(fontTheme.data)}`);
const inUse = await superAdmin("/api/fonts", { method: "DELETE", body: { id: font?.id } });
check("suppression refusée quand un thème utilise la police (409)", inUse.status === 409, `${inUse.status} ${JSON.stringify(inUse.data)}`);
await superAdmin("/api/themes", { method: "DELETE", body: { id: fontTheme.data?.id } });
const fontDel = await superAdmin("/api/fonts", { method: "DELETE", body: { id: font?.id } });
check("admin supprime la police une fois libre", fontDel.status === 200, `${fontDel.status} ${JSON.stringify(fontDel.data)}`);
check("fichier de la police supprimée introuvable", fileUrl !== "" && (await fetch(fileUrl)).status >= 400);

const search = await superAdmin("/api/fonts/catalog?q=abeezee");
if (search.status === 502) console.log("skip catalogue : Fontsource injoignable");
else {
  check("admin cherche dans le catalogue", search.status === 200 && search.data.some?.((f) => f.id === "abeezee"), `${search.status} ${JSON.stringify(search.data)}`);
  const copy = await superAdmin("/api/fonts/catalog", { method: "POST", body: { id: "abeezee", weights: [400], italic: false } });
  check("admin copie une police du catalogue (201, woff2)", copy.status === 201 && copy.data.files?.length > 0 && copy.data.files.every((f) => f.format === "woff2"), `${copy.status} ${JSON.stringify(copy.data)}`);
  if (copy.data?.id) check("admin supprime la police copiée", (await superAdmin("/api/fonts", { method: "DELETE", body: { id: copy.data.id } })).status === 200);
}

await cleanup();
await removeRole(staffId);

console.log(`\n${failures ? `${failures} échec(s)` : "Tout est passé."}`);
process.exit(failures ? 1 : 0);
