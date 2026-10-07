/**
 * Test de bout en bout de Flexdesign (routes HTTP), contre la base LOCALE de la suite et l'appli lancée en local.
 * Utilise les comptes de test de flexstaff (TEST_* dans .env). Donne puis retire un rôle flexdesign au compte staff,
 * et, pour les moodboards, un rôle staff flexdesign temporaire à l'admin Flexform (deuxième membre de l'équipe).
 *
 *   node --env-file=.env scripts/e2e.mjs [adresse, défaut http://localhost:8788]
 */
import { randomBytes, randomUUID } from "node:crypto";

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
    return { status: res.status, data, cookies: jar.size, type: res.headers.get("content-type") ?? "" };
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

/** Fichiers du dossier d'un moodboard dans le bucket privé design-assets (clé service_role). */
const boardFiles = async (boardId) => {
  const res = await admin("/storage/v1/object/list/design-assets", { method: "POST", body: JSON.stringify({ prefix: boardId, limit: 1000 }) });
  return res.ok ? (await res.json()).map((f) => `${boardId}/${f.name}`) : [];
};

/** Restes des tests : thèmes "e2e-...", polices envoyées "e2e-...", copie du catalogue abeezee, fichiers tentés par staff / anon,
 *  moodboards "e2e-..." et les fichiers de leurs dossiers. */
async function cleanup() {
  const boards = await (await admin("/rest/v1/design_boards?select=id&title=like.e2e-*")).json();
  const boardPaths = (await Promise.all(boards.map((b) => boardFiles(b.id)))).flat();
  if (boardPaths.length) await admin("/storage/v1/object/design-assets", { method: "DELETE", body: JSON.stringify({ prefixes: boardPaths }) });
  if (boards.length) await admin(`/rest/v1/design_boards?id=in.(${boards.map((b) => b.id).join(",")})`, { method: "DELETE" });
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
const formAdminId = await userId(env.TEST_ADMIN_EMAIL);
await removeRole(staffId);
await removeRole(formAdminId);
await cleanup();
// Le script se connecte plusieurs fois : compteur de tentatives remis à zéro (base locale uniquement)
await admin("/rest/v1/suite_rate_limits?key=like.flexdesign:login:*", { method: "DELETE" });
await admin("/rest/v1/suite_rate_limits?key=like.flexdesign:public-board:*", { method: "DELETE" });

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

// Moodboards : staff A = compte staff, staff B = admin Flexform avec un rôle staff Flexdesign temporaire
console.log("\n# Moodboards");
await setRole(staffId, "staff");
await setRole(formAdminId, "staff");
const superId = await userId(env.TEST_SUPER_EMAIL);
const folioId = await userId(env.TEST_FOLIO_EMAIL);
const staffB = browser();
const rB = await login(staffB, env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);
check("staff B (admin Flexform avec un rôle staff Flexdesign) connecté en staff", rB.status === 200 && rB.data.role === "staff", `${rB.status}`);

check("visiteur ne peut pas lire /api/boards", (await visitor("/api/boards")).status === 401);
check("visiteur ne peut pas créer de moodboard", (await visitor("/api/boards", { method: "POST", body: { title: "e2e-visiteur" } })).status === 401);
check("visiteur ne peut pas lire /api/team", (await visitor("/api/team")).status === 401);

const teamList = await staff("/api/team");
const teamIds = teamList.status === 200 ? teamList.data.map((m) => m.userId) : [];
check("staff lit l'équipe Flexdesign : staff B et super admin, pas l'admin Flexfolio", teamIds.includes(formAdminId) && teamIds.includes(superId) && !teamIds.includes(folioId), `${teamList.status} ${JSON.stringify(teamList.data)}`);

const madeBoard = await staff("/api/boards", { method: "POST", body: { title: "e2e-board", description: "test" } });
const board = madeBoard.data ?? {};
check("staff A crée un moodboard (201, propriétaire)", madeBoard.status === 201 && board.access === "owner" && typeof board.id === "string", `${madeBoard.status} ${JSON.stringify(madeBoard.data)}`);
const madeAdminBoard = await superAdmin("/api/boards", { method: "POST", body: { title: "e2e-board-admin" } });
const adminBoard = madeAdminBoard.data ?? {};
check("super admin crée son propre moodboard (201)", madeAdminBoard.status === 201 && adminBoard.access === "owner", `${madeAdminBoard.status} ${JSON.stringify(madeAdminBoard.data)}`);

const PNG_1PX = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082", "hex"));
const imageForm = (boardId, fields, bytes, type) => {
  const form = new FormData();
  form.append("boardId", String(boardId));
  form.append("file", new Blob([bytes], { type }), "image.png");
  for (const [k, v] of Object.entries({ widthPx: 1, heightPx: 1, x: 100, y: 100, w: 320, ...fields })) form.append(k, String(v));
  return form;
};
const addImage = (who, boardId, fields = {}, bytes = PNG_1PX, type = "image/png") => who("/api/boards/items", { method: "POST", form: imageForm(boardId, fields, bytes, type) });
const moveItem = (who, id, fields) => who("/api/boards/items/update", { method: "POST", body: { id, ...fields } });
const deleteItem = (who, id) => who("/api/boards/items", { method: "DELETE", body: { id } });
const expect = async (label, pending, statuses) => {
  const r = await pending;
  check(label, statuses.includes(r.status), `${r.status} ${JSON.stringify(r.data)}`);
  return r;
};

const upA = await addImage(staff, board.id);
const item = upA.data ?? {};
check("staff A envoie une image (201)", upA.status === 201 && item.url === `/api/boards/image?id=${item.id}`, `${upA.status} ${JSON.stringify(upA.data)}`);
const movedA = await moveItem(staff, item.id, { x: 500, y: 250, note: "  référence  " });
check("staff A déplace l'image et modifie sa note (200)", movedA.status === 200 && movedA.data.x === 500 && movedA.data.y === 250 && movedA.data.note === "référence", `${movedA.status} ${JSON.stringify(movedA.data)}`);
const imageA = await staff(`/api/boards/image?id=${item.id}`);
check("staff A lit l'image (200, image/png)", imageA.status === 200 && imageA.type === "image/png", `${imageA.status} ${imageA.type}`);

/** Le moodboard de staff A n'existe pas pour ce compte : absent de la liste, détail et image en 404. */
const cannotSee = async (who, label) => {
  const list = await who("/api/boards");
  check(`${label} ne voit pas le moodboard de staff A dans /api/boards`, list.status === 200 && !list.data.some((b) => b.id === board.id), `${list.status}`);
  await expect(`${label} ne peut pas lire le détail du moodboard de staff A (404)`, who(`/api/boards/detail?id=${board.id}`), [404]);
  await expect(`${label} ne peut pas lire l'image du moodboard de staff A (404)`, who(`/api/boards/image?id=${item.id}`), [404]);
};
await cannotSee(staffB, "staff B (non partagé)");
await expect("staff B (non partagé) ne peut pas envoyer d'image", addImage(staffB, board.id), [403, 404]);
await expect("staff B (non partagé) ne peut pas déplacer une image (404)", moveItem(staffB, item.id, { x: 0 }), [404]);
await expect("staff B (non partagé) ne peut pas supprimer une image (404)", deleteItem(staffB, item.id), [404]);
await cannotSee(superAdmin, "super admin (admin Flexdesign)");
await expect("super admin ne peut pas modifier l'image de staff A (404)", moveItem(superAdmin, item.id, { x: 0 }), [404]);
await expect("super admin ne peut pas changer les réglages du moodboard de staff A (404)", superAdmin("/api/boards/settings", { method: "POST", body: { id: board.id, title: "e2e-pirate", teamRead: true } }), [404]);
await expect("super admin ne peut pas supprimer le moodboard de staff A (404)", superAdmin("/api/boards", { method: "DELETE", body: { id: board.id } }), [404]);

const shareB = (canEdit) => staff("/api/boards/members", { method: "POST", body: { boardId: board.id, userId: formAdminId, canEdit } });
const sharedRead = await shareB(false);
check("staff A partage avec staff B en lecture", sharedRead.status === 200 && sharedRead.data.length === 1 && sharedRead.data[0].userId === formAdminId && sharedRead.data[0].canEdit === false, `${sharedRead.status} ${JSON.stringify(sharedRead.data)}`);
const firstLink = await staff("/api/boards/link", { method: "POST", body: { boardId: board.id } });
let shareToken = firstLink.data?.token ?? "";
check("staff A crée le lien public (jeton de 43 caractères)", firstLink.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(shareToken), `${firstLink.status}`);
const listB = await staffB("/api/boards");
check("staff B voit le moodboard partagé, en lecture", listB.status === 200 && listB.data.find((b) => b.id === board.id)?.access === "read", `${listB.status} ${JSON.stringify(listB.data)}`);
const detailB = await staffB(`/api/boards/detail?id=${board.id}`);
check("détail pour staff B : lecture, sans liste de membres ni lien public", detailB.status === 200 && detailB.data.access === "read" && detailB.data.members?.length === 0 && detailB.data.shareToken === null && detailB.data.items?.length === 1, `${detailB.status} ${JSON.stringify(detailB.data)}`);
const detailA = await staff(`/api/boards/detail?id=${board.id}`);
check("détail pour staff A : membres et lien public", detailA.status === 200 && detailA.data.members?.length === 1 && detailA.data.shareToken === shareToken, `${detailA.status}`);
const imageB = await staffB(`/api/boards/image?id=${item.id}`);
check("staff B (lecture) lit l'image (200)", imageB.status === 200 && imageB.type === "image/png", `${imageB.status}`);
await expect("staff B (lecture) ne peut pas envoyer d'image (403)", addImage(staffB, board.id), [403]);
await expect("staff B (lecture) ne peut pas déplacer une image (403)", moveItem(staffB, item.id, { x: 0 }), [403]);
await expect("staff B (lecture) ne peut pas supprimer une image (403)", deleteItem(staffB, item.id), [403]);
const refusedToMember = async (label) => {
  await expect(`${label} ne peut pas changer les réglages (403)`, staffB("/api/boards/settings", { method: "POST", body: { id: board.id, title: "e2e-pirate", teamRead: true } }), [403]);
  await expect(`${label} ne peut pas gérer les membres (403)`, staffB("/api/boards/members", { method: "POST", body: { boardId: board.id, userId: superId, canEdit: true } }), [403]);
  await expect(`${label} ne peut pas retirer un membre (403)`, staffB("/api/boards/members", { method: "DELETE", body: { boardId: board.id, userId: formAdminId } }), [403]);
  await expect(`${label} ne peut pas créer le lien public (403)`, staffB("/api/boards/link", { method: "POST", body: { boardId: board.id } }), [403]);
  await expect(`${label} ne peut pas désactiver le lien public (403)`, staffB("/api/boards/link", { method: "DELETE", body: { boardId: board.id } }), [403]);
  await expect(`${label} ne peut pas supprimer le moodboard (403)`, staffB("/api/boards", { method: "DELETE", body: { id: board.id } }), [403]);
};
await refusedToMember("staff B (lecture)");

const sharedEdit = await shareB(true);
check("staff A passe staff B en modification", sharedEdit.status === 200 && sharedEdit.data.length === 1 && sharedEdit.data[0].canEdit === true, `${sharedEdit.status} ${JSON.stringify(sharedEdit.data)}`);
const upB = await addImage(staffB, board.id, { x: 10, y: 10 });
check("staff B (modification) envoie une image (201)", upB.status === 201 && typeof upB.data?.id === "string", `${upB.status} ${JSON.stringify(upB.data)}`);
const movedB = await moveItem(staffB, item.id, { x: 600, z: 5 });
check("staff B (modification) déplace une image (200)", movedB.status === 200 && movedB.data.x === 600 && movedB.data.z === 5, `${movedB.status} ${JSON.stringify(movedB.data)}`);
await expect("staff B (modification) supprime son image (200)", deleteItem(staffB, upB.data?.id), [200]);
await refusedToMember("staff B (modification)");

const removedB = await staff("/api/boards/members", { method: "DELETE", body: { boardId: board.id, userId: formAdminId } });
check("staff A retire staff B du moodboard", removedB.status === 200 && removedB.data.length === 0, `${removedB.status} ${JSON.stringify(removedB.data)}`);
await cannotSee(staffB, "staff B (retiré)");

const settings = (teamRead) => staff("/api/boards/settings", { method: "POST", body: { id: board.id, title: "e2e-board", description: "test", teamRead } });
await expect("staff A ouvre le moodboard en lecture à toute l'équipe (200)", settings(true), [200]);
const teamListB = await staffB("/api/boards");
check("lecture par l'équipe : staff B voit le moodboard en lecture", teamListB.status === 200 && teamListB.data.find((b) => b.id === board.id)?.access === "read", `${teamListB.status}`);
const teamListSuper = await superAdmin("/api/boards");
check("lecture par l'équipe : super admin voit le moodboard en lecture", teamListSuper.status === 200 && teamListSuper.data.find((b) => b.id === board.id)?.access === "read", `${teamListSuper.status}`);
const teamDetailB = await staffB(`/api/boards/detail?id=${board.id}`);
check("lecture par l'équipe : détail pour staff B sans membres ni lien public", teamDetailB.status === 200 && teamDetailB.data.access === "read" && teamDetailB.data.members?.length === 0 && teamDetailB.data.shareToken === null, `${teamDetailB.status} ${JSON.stringify(teamDetailB.data)}`);
await expect("lecture par l'équipe : staff B ne peut pas envoyer d'image (403)", addImage(staffB, board.id), [403]);
await expect("lecture par l'équipe : staff B ne peut pas déplacer une image (403)", moveItem(staffB, item.id, { x: 0 }), [403]);
await expect("staff A referme le moodboard à l'équipe (200)", settings(false), [200]);
await cannotSee(superAdmin, "super admin (moodboard refermé)");

console.log("\n# Moodboards : refus");
await expect("partage refusé : le propriétaire avec lui-même (400)", staff("/api/boards/members", { method: "POST", body: { boardId: board.id, userId: staffId, canEdit: false } }), [400]);
await expect("partage refusé : compte hors de l'équipe Flexdesign (admin Flexfolio) (400)", staff("/api/boards/members", { method: "POST", body: { boardId: board.id, userId: folioId, canEdit: false } }), [400]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>');
await expect("envoi refusé : contenu SVG (400)", addImage(staff, board.id, {}, svg, "image/svg+xml"), [400]);
await expect("envoi refusé : PNG vers le moodboard non partagé d'un autre compte", addImage(staff, adminBoard.id), [403, 404]);
const big = new Uint8Array(5 * 1024 * 1024 + 1);
big.set(PNG_1PX);
await expect("envoi refusé : image de plus de 5 Mo (413)", addImage(staff, board.id, {}, big), [413]);
await expect("envoi refusé : position hors de la toile (400)", addImage(staff, board.id, { x: 999999 }), [400]);
await expect("modification refusée : position hors de la toile (400)", moveItem(staff, item.id, { x: 999999 }), [400]);

await shareB(false);
await removeRole(formAdminId);
await expect("rôle retiré : staff B, membre du moodboard, reçoit 403 à la requête suivante", staffB(`/api/boards/detail?id=${board.id}`), [403]);
const noRoleRows = await direct(`/rest/v1/design_boards?select=id&id=eq.${board.id}`, formToken);
check("rôle retiré : la base ne montre plus le moodboard à staff B (jeton direct)", noRoleRows.status >= 400 || (await noRoleRows.json()).length === 0, `${noRoleRows.status}`);
await setRole(formAdminId, "staff");
await expect("rôle rendu : staff B lit de nouveau le moodboard partagé", staffB(`/api/boards/detail?id=${board.id}`), [200]);
await staff("/api/boards/members", { method: "DELETE", body: { boardId: board.id, userId: formAdminId } });

console.log("\n# Moodboards : base de données en direct (RLS)");
const folioToken = await token(env.TEST_FOLIO_EMAIL, env.TEST_FOLIO_PASSWORD);
/** Lignes renvoyées par la base (une erreur compte comme aucune ligne). */
const rowsOf = async (path, bearer) => {
  const r = await direct(path, bearer);
  return r.status < 400 ? await r.json() : [];
};
const patchRows = async (path, bearer, body) => {
  const r = await direct(path, bearer, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
  return { status: r.status, rows: r.status < 400 ? await r.json() : [] };
};
const serviceRow = async (path) => (await (await admin(path)).json())[0] ?? {};
const itemPath = (await serviceRow(`/rest/v1/design_board_items?select=path&id=eq.${item.id}`)).path ?? "";
check("chemin de l'image rangé dans le dossier du moodboard", itemPath.startsWith(`${board.id}/`), itemPath);

for (const table of ["design_boards", "design_board_items", "design_board_links", "design_board_members"]) {
  check(`visiteur (anon) ne lit rien dans ${table}`, (await rowsOf(`/rest/v1/${table}?select=*`)).length === 0);
}
const anonTeam = await direct("/rest/v1/rpc/design_team", undefined, { method: "POST", body: "{}" });
check("visiteur (anon) ne peut pas appeler design_team", anonTeam.status >= 400, `${anonTeam.status}`);
check("admin Flexfolio (sans rôle flexdesign) ne lit rien dans design_boards", (await rowsOf("/rest/v1/design_boards?select=id", folioToken)).length === 0);
const folioTeam = await direct("/rest/v1/rpc/design_team", folioToken, { method: "POST", body: "{}" });
check("admin Flexfolio (sans rôle flexdesign) ne peut pas appeler design_team (403)", folioTeam.status === 403, `${folioTeam.status} ${await folioTeam.text()}`);

check("staff B (non partagé) ne lit pas la ligne du moodboard", (await rowsOf(`/rest/v1/design_boards?select=id&id=eq.${board.id}`, formToken)).length === 0);
check("staff B (non partagé) ne lit pas les images du moodboard", (await rowsOf(`/rest/v1/design_board_items?select=id&board_id=eq.${board.id}`, formToken)).length === 0);
const strayItem = { board_id: board.id, path: `${board.id}/${randomUUID()}.png`, mime: "image/png", width_px: 1, height_px: 1, created_by: formAdminId };
const insertItemB = await direct("/rest/v1/design_board_items", formToken, { method: "POST", body: JSON.stringify(strayItem) });
check("staff B (non partagé) ne peut pas insérer d'image dans le moodboard", insertItemB.status >= 400, `${insertItemB.status}`);
const insertSelfB = await direct("/rest/v1/design_board_members", formToken, { method: "POST", body: JSON.stringify({ board_id: board.id, user_id: formAdminId, can_edit: true }) });
check("staff B ne peut pas s'ajouter lui-même dans design_board_members", insertSelfB.status >= 400, `${insertSelfB.status}`);
const insertFolio = await direct("/rest/v1/design_board_members", staffToken, { method: "POST", body: JSON.stringify({ board_id: board.id, user_id: folioId, can_edit: false }) });
check("propriétaire ne peut pas ajouter un compte hors de l'équipe dans design_board_members", insertFolio.status >= 400, `${insertFolio.status}`);
const insertOwnerSelf = await direct("/rest/v1/design_board_members", staffToken, { method: "POST", body: JSON.stringify({ board_id: board.id, user_id: staffId, can_edit: true }) });
check("propriétaire ne peut pas s'ajouter comme membre de son moodboard", insertOwnerSelf.status >= 400, `${insertOwnerSelf.status}`);
const stealBoard = await direct("/rest/v1/design_boards", formToken, { method: "POST", body: JSON.stringify({ owner_id: staffId, title: "e2e-vole" }) });
check("staff B ne peut pas créer un moodboard au nom d'un autre compte", stealBoard.status >= 400, `${stealBoard.status}`);

const storageGet = (bearer, path) => direct(`/storage/v1/object/authenticated/design-assets/${path}`, bearer);
const storagePutAsset = (bearer, path) => direct(`/storage/v1/object/design-assets/${path}`, bearer, { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG_1PX });
check("propriétaire télécharge le fichier directement (témoin)", (await storageGet(staffToken, itemPath)).status === 200);
const getB = await storageGet(formToken, itemPath);
check("staff B (non partagé) ne peut pas télécharger le fichier du moodboard", getB.status >= 400, `${getB.status}`);
const putB = await storagePutAsset(formToken, `${board.id}/${randomUUID()}.png`);
check("staff B (non partagé) ne peut pas déposer de fichier dans le dossier du moodboard", putB.status >= 400, `${putB.status}`);
const getAnon = await storageGet(undefined, itemPath);
check("visiteur (anon) ne peut pas télécharger le fichier", getAnon.status >= 400, `${getAnon.status}`);
const putAnon = await storagePutAsset(undefined, `${board.id}/${randomUUID()}.png`);
check("visiteur (anon) ne peut pas déposer de fichier dans design-assets", putAnon.status >= 400, `${putAnon.status}`);
const getSuper = await storageGet(await token(env.TEST_SUPER_EMAIL, env.TEST_SUPER_PASSWORD), itemPath);
check("super admin ne peut pas télécharger le fichier du moodboard de staff A", getSuper.status >= 400, `${getSuper.status}`);

await shareB(false);
check("staff B (lecture) lit la ligne du moodboard (témoin)", (await rowsOf(`/rest/v1/design_boards?select=id&id=eq.${board.id}`, formToken)).length === 1);
check("staff B (lecture) ne peut pas lire design_board_links", (await rowsOf(`/rest/v1/design_board_links?select=token&board_id=eq.${board.id}`, formToken)).length === 0);
const readPatch = await patchRows(`/rest/v1/design_board_items?id=eq.${item.id}`, formToken, { x: 1 });
const afterReadPatch = await serviceRow(`/rest/v1/design_board_items?select=x&id=eq.${item.id}`);
check("staff B (lecture) ne peut pas modifier x d'une image (0 ligne)", readPatch.rows.length === 0 && afterReadPatch.x === 600, `${readPatch.status} ${JSON.stringify(readPatch.rows)}`);
const selfEdit = await patchRows(`/rest/v1/design_board_members?board_id=eq.${board.id}&user_id=eq.${formAdminId}`, formToken, { can_edit: true });
const afterSelfEdit = await serviceRow(`/rest/v1/design_board_members?select=can_edit&board_id=eq.${board.id}&user_id=eq.${formAdminId}`);
check("staff B (lecture) ne peut pas se donner le droit de modification", selfEdit.rows.length === 0 && afterSelfEdit.can_edit === false, `${selfEdit.status} ${JSON.stringify(selfEdit.rows)}`);
check("staff B (lecture) télécharge le fichier (témoin)", (await storageGet(formToken, itemPath)).status === 200);
const putRead = await storagePutAsset(formToken, `${board.id}/${randomUUID()}.png`);
check("staff B (lecture) ne peut pas déposer de fichier dans le dossier du moodboard", putRead.status >= 400, `${putRead.status}`);

await shareB(true);
const moveBoard = await patchRows(`/rest/v1/design_board_items?id=eq.${item.id}`, formToken, { board_id: adminBoard.id });
check("staff B (modification) ne peut pas changer board_id d'une image", moveBoard.status >= 400, `${moveBoard.status} ${JSON.stringify(moveBoard.rows)}`);
const movePath = await patchRows(`/rest/v1/design_board_items?id=eq.${item.id}`, formToken, { path: `${board.id}/${randomUUID()}.png` });
check("staff B (modification) ne peut pas changer path d'une image", movePath.status >= 400, `${movePath.status} ${JSON.stringify(movePath.rows)}`);
check("staff B (modification) ne peut toujours pas lire design_board_links", (await rowsOf(`/rest/v1/design_board_links?select=token&board_id=eq.${board.id}`, formToken)).length === 0);
const afterItem = await serviceRow(`/rest/v1/design_board_items?select=board_id,path&id=eq.${item.id}`);
check("image toujours dans son moodboard et son fichier", afterItem.board_id === board.id && afterItem.path === itemPath, JSON.stringify(afterItem));
const giveAway = await patchRows(`/rest/v1/design_boards?id=eq.${board.id}`, staffToken, { owner_id: formAdminId });
const afterGiveAway = await serviceRow(`/rest/v1/design_boards?select=owner_id&id=eq.${board.id}`);
check("propriétaire ne peut pas changer owner_id", giveAway.status >= 400 && afterGiveAway.owner_id === staffId, `${giveAway.status} ${JSON.stringify(giveAway.rows)}`);
await staff("/api/boards/members", { method: "DELETE", body: { boardId: board.id, userId: formAdminId } });

console.log("\n# Moodboards : lien public");
const pub = browser();
const publicGet = (t) => pub(`/api/public/board?token=${t}`);
const pb = await publicGet(shareToken);
const pbItems = pb.data?.items ?? [];
check("lien public lu sans compte (200, images servies par /api/public/image)", pb.status === 200 && pb.data.title === "e2e-board" && pbItems.length === 1 && pbItems.every((i) => i.url === `/api/public/image?token=${shareToken}&id=${i.id}`), `${pb.status} ${JSON.stringify(pb.data)}`);
const pbRaw = JSON.stringify(pb.data);
check("lien public : ni chemin de fichier ni propriétaire ni identifiant du moodboard", !/"path"|owner/i.test(pbRaw) && !pbRaw.includes(board.id), pbRaw);
const pubImage = await pub(pbItems[0]?.url ?? "/api/public/image");
check("image du lien public (200, image/png)", pubImage.status === 200 && pubImage.type === "image/png", `${pubImage.status} ${pubImage.type}`);
const unknownToken = randomBytes(32).toString("base64url");
await expect("lien public refusé : jeton inconnu de 43 caractères (404)", publicGet(unknownToken), [404]);
await expect("image du lien public refusée : jeton inconnu (404)", pub(`/api/public/image?token=${unknownToken}&id=${item.id}`), [404]);
const regen = await staff("/api/boards/link", { method: "POST", body: { boardId: board.id } });
const newToken = regen.data?.token ?? "";
check("staff A régénère le lien public (nouveau jeton)", regen.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(newToken) && newToken !== shareToken, `${regen.status}`);
await expect("lien public refusé : ancien jeton après régénération (404)", publicGet(shareToken), [404]);
await expect("image du lien public refusée : ancien jeton après régénération (404)", pub(`/api/public/image?token=${shareToken}&id=${item.id}`), [404]);
await expect("lien public : nouveau jeton lu (200)", publicGet(newToken), [200]);
shareToken = newToken;
await removeRole(staffId);
await expect("lien public refusé quand le propriétaire n'a plus de rôle Flexdesign (404)", publicGet(shareToken), [404]);
await setRole(staffId, "staff");
await expect("staff A désactive le lien public (200)", staff("/api/boards/link", { method: "DELETE", body: { boardId: board.id } }), [200]);
await expect("lien public refusé après désactivation (404)", publicGet(shareToken), [404]);
const rpcBad = await direct("/rest/v1/rpc/design_board_by_token", undefined, { method: "POST", body: JSON.stringify({ p_token: unknownToken }) });
const rpcBadText = await rpcBad.text();
check("visiteur (anon) : design_board_by_token avec un jeton inconnu renvoie null", rpcBad.status === 200 && rpcBadText.trim() === "null", `${rpcBad.status} ${rpcBadText}`);

console.log("\n# Moodboards : suppression");
const lastLink = await staff("/api/boards/link", { method: "POST", body: { boardId: board.id } });
const lastToken = lastLink.data?.token ?? "";
await expect("lien public actif avant suppression (200)", publicGet(lastToken), [200]);
check("fichiers présents dans le dossier du moodboard avant suppression (témoin)", (await boardFiles(board.id)).length > 0);
await expect("staff A supprime son moodboard (200)", staff("/api/boards", { method: "DELETE", body: { id: board.id } }), [200]);
check("moodboard supprimé : plus aucune image en base", (await (await admin(`/rest/v1/design_board_items?select=id&board_id=eq.${board.id}`)).json()).length === 0);
const leftFiles = await boardFiles(board.id);
check("moodboard supprimé : plus aucun fichier dans son dossier", leftFiles.length === 0, JSON.stringify(leftFiles));
await expect("moodboard supprimé : le lien public ne fonctionne plus (404)", publicGet(lastToken), [404]);
await expect("moodboard déjà supprimé : 404", staff("/api/boards", { method: "DELETE", body: { id: board.id } }), [404]);
await expect("super admin supprime son propre moodboard (200)", superAdmin("/api/boards", { method: "DELETE", body: { id: adminBoard.id } }), [200]);

await cleanup();
await removeRole(staffId);
await removeRole(formAdminId);

console.log(`\n${failures ? `${failures} échec(s)` : "Tout est passé."}`);
process.exit(failures ? 1 : 0);
