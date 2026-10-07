-- =====================================================================
-- Flexdesign : thèmes (couleurs, polices) que chaque appli de la suite peut adopter si elle le veut
-- Idempotent : relançable tel quel, sur une base vierge comme sur la production existante (rien n'est
-- perdu : ce qui manque est ajouté, les règles de sécurité sont remises à leur version actuelle).
-- Toute évolution du schéma de l'appli se fait dans ce fichier.
--
-- À appliquer APRÈS supabase/init.sql du dépôt flexstaff (droits de la suite) :
--   En local      : npm run db:setup (base en place) ou npm run db:reset (base vierge), dans flexstaff
--   En production : SQL Editor de Supabase, flexstaff d'abord, puis ce fichier
-- =====================================================================

do $$
begin
  if to_regprocedure('public.suite_has_app_role(text, text[])') is null then
    raise exception 'Appliquer d''abord supabase/init.sql du dépôt flexstaff (droits de la suite).';
  end if;
end
$$;

-- Inscription dans la suite : ses admins et son staff se gèrent dans app_roles (Flexstaff)
insert into public.suite_apps (app, name) values ('flexdesign', 'Flexdesign') on conflict (app) do nothing;

--   design_fonts          Polices disponibles : copiées du catalogue Google Fonts (via Fontsource) ou
--                         envoyées par l'équipe (licence détenue, cochée à l'envoi).
--   design_font_files     Fichiers de chaque police (graisse, style, sous-ensemble) dans le bucket public
--                         design-fonts. Chemins et noms de famille générés par Flexdesign, jamais saisis.
--   design_themes         Thèmes : nom, variante sombre ou non.
--   design_theme_colors   Couleurs d'un thème : 12 rôles fixes par mode, jusqu'à 24 couleurs nommées
--                         (une seule valeur pour les deux modes), nuances calculées par Flexdesign.
--   design_theme_fonts    Police de chaque rôle d'un thème (titre, texte, accent, chasse fixe).
--   design_save_theme()   Enregistre un thème avec toutes ses couleurs et polices, en une transaction.
--
-- Droits : lecture publique (visiteurs compris : les applis qui se lient à un thème le lisent avec la clé
-- anon) ; écriture réservée aux admins Flexdesign et aux super admins. Le staff Flexdesign lit seulement.
--
-- Erreurs renvoyées par design_save_theme (PostgREST traduit PTxxx en statut HTTP xxx) :
--   PT403 'Réservé aux admins de Flexdesign.'
--   PT404 'Thème introuvable.'
--   PT400 'Il manque des couleurs : chaque rôle doit en avoir une.' / '24 couleurs nommées au maximum.'

-- ---------------------------------------------------------------------------
-- Polices
-- ---------------------------------------------------------------------------

create table if not exists public.design_fonts (
  id uuid primary key default gen_random_uuid(),
  -- Nom de famille utilisé dans le CSS : celui du catalogue, ou généré pour une police envoyée
  family text not null unique check (family ~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,62}$'),
  -- Nom affiché dans Flexdesign (saisi pour une police envoyée) : jamais utilisé dans du CSS
  label text not null check (char_length(label) between 1 and 80),
  source text not null check (source in ('catalog', 'upload')),
  catalog_id text unique check (catalog_id ~ '^[a-z0-9-]{1,80}$'),
  category text not null check (category in ('sans-serif', 'serif', 'display', 'handwriting', 'monospace', 'other')),
  -- 'own' : police envoyée, l'admin a coché « je détiens la licence »
  license text not null check (license in ('OFL-1.1', 'Apache-2.0', 'UFL-1.0', 'own')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((source = 'catalog') = (catalog_id is not null)),
  check ((source = 'upload') = (license = 'own'))
);

create table if not exists public.design_font_files (
  id uuid primary key default gen_random_uuid(),
  font_id uuid not null references public.design_fonts (id) on delete cascade,
  weight int not null check (weight between 100 and 900 and weight % 100 = 0),
  style text not null check (style in ('normal', 'italic')),
  -- Sous-ensemble du catalogue (ex. latin) et sa plage Unicode ; null pour une police envoyée (fichier complet)
  subset text check (subset ~ '^[a-z0-9-]{1,40}$'),
  unicode_range text check (unicode_range ~ '^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(,U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$'),
  format text not null check (format in ('woff2', 'woff', 'truetype', 'opentype')),
  -- Chemin dans le bucket design-fonts : <id de la police>/<nom généré>.<extension>
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[a-z0-9-]{1,80}\.(woff2|woff|ttf|otf)$'),
  unique nulls not distinct (font_id, weight, style, subset)
);

-- ---------------------------------------------------------------------------
-- Thèmes
-- ---------------------------------------------------------------------------

create table if not exists public.design_themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 60),
  has_dark boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.design_theme_colors (
  theme_id uuid not null references public.design_themes (id) on delete cascade,
  mode text not null check (mode in ('light', 'dark')),
  kind text not null check (kind in ('role', 'named', 'derived')),
  name text not null,
  -- Toujours #rrggbb en minuscules : chaque appli revérifie à la lecture avant de l'utiliser
  hex text not null check (hex ~ '^#[0-9a-f]{6}$'),
  position int not null default 0,
  primary key (theme_id, mode, name),
  check (kind <> 'role' or name in ('background', 'surface', 'text', 'muted', 'border', 'primary', 'onPrimary',
                                    'accent', 'onAccent', 'success', 'warning', 'danger')),
  check (kind <> 'derived' or name in ('primaryHover', 'primarySoft', 'accentHover', 'accentSoft', 'successHover',
                                       'successSoft', 'warningHover', 'warningSoft', 'dangerHover', 'dangerSoft')),
  check (kind <> 'named' or (mode = 'light' and name ~ '^[a-z][a-z0-9-]{0,31}$'))
);

create table if not exists public.design_theme_fonts (
  theme_id uuid not null references public.design_themes (id) on delete cascade,
  role text not null check (role in ('heading', 'body', 'accent', 'mono')),
  -- Une police utilisée par un thème ne peut pas être supprimée
  font_id uuid not null references public.design_fonts (id) on delete restrict,
  fallback text not null check (fallback in ('sans-serif', 'serif', 'monospace', 'cursive', 'system-ui')),
  primary key (theme_id, role)
);
create index if not exists design_theme_fonts_font_id on public.design_theme_fonts (font_id);

-- ---------------------------------------------------------------------------
-- Sécurité par ligne : lecture publique, écriture admin Flexdesign
-- ---------------------------------------------------------------------------

alter table public.design_fonts enable row level security;
alter table public.design_font_files enable row level security;
alter table public.design_themes enable row level security;
alter table public.design_theme_colors enable row level security;
alter table public.design_theme_fonts enable row level security;

revoke insert, update, delete, truncate on public.design_fonts, public.design_font_files, public.design_themes,
  public.design_theme_colors, public.design_theme_fonts from anon;

drop policy if exists "design_fonts_read" on public.design_fonts;
create policy "design_fonts_read" on public.design_fonts for select using (true);
drop policy if exists "design_fonts_admin_write" on public.design_fonts;
create policy "design_fonts_admin_write" on public.design_fonts
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_font_files_read" on public.design_font_files;
create policy "design_font_files_read" on public.design_font_files for select using (true);
drop policy if exists "design_font_files_admin_write" on public.design_font_files;
create policy "design_font_files_admin_write" on public.design_font_files
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_themes_read" on public.design_themes;
create policy "design_themes_read" on public.design_themes for select using (true);
drop policy if exists "design_themes_admin_write" on public.design_themes;
create policy "design_themes_admin_write" on public.design_themes
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_theme_colors_read" on public.design_theme_colors;
create policy "design_theme_colors_read" on public.design_theme_colors for select using (true);
drop policy if exists "design_theme_colors_admin_write" on public.design_theme_colors;
create policy "design_theme_colors_admin_write" on public.design_theme_colors
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_theme_fonts_read" on public.design_theme_fonts;
create policy "design_theme_fonts_read" on public.design_theme_fonts for select using (true);
drop policy if exists "design_theme_fonts_admin_write" on public.design_theme_fonts;
create policy "design_theme_fonts_admin_write" on public.design_theme_fonts
  for all to authenticated
  using ((select public.suite_has_app_role('flexdesign', array['admin'])))
  with check ((select public.suite_has_app_role('flexdesign', array['admin'])));

-- ---------------------------------------------------------------------------
-- Enregistrement d'un thème
-- ---------------------------------------------------------------------------

-- p_theme : { id (absent = nouveau thème), name, has_dark, colors: [{ mode, kind, name, hex, position }],
--             fonts: [{ role, font_id, fallback }] }. Remplace toutes les couleurs et polices du thème.
-- security invoker : la RLS s'applique avec le jeton de l'admin, comme pour une écriture directe.
create or replace function public.design_save_theme(p_theme jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_theme->>'id', '')::uuid;
  v_dark boolean := coalesce((p_theme->>'has_dark')::boolean, false);
begin
  if not public.suite_has_app_role('flexdesign', array['admin']) then
    raise sqlstate 'PT403' using message = 'Réservé aux admins de Flexdesign.';
  end if;

  if v_id is null then
    insert into public.design_themes (name, has_dark) values (p_theme->>'name', v_dark) returning id into v_id;
  else
    update public.design_themes set name = p_theme->>'name', has_dark = v_dark, updated_at = now() where id = v_id;
    if not found then
      raise sqlstate 'PT404' using message = 'Thème introuvable.';
    end if;
    delete from public.design_theme_colors where theme_id = v_id;
    delete from public.design_theme_fonts where theme_id = v_id;
  end if;

  insert into public.design_theme_colors (theme_id, mode, kind, name, hex, position)
  select v_id, c.mode, c.kind, c.name, c.hex, coalesce(c.position, 0)
  from jsonb_to_recordset(coalesce(p_theme->'colors', '[]'::jsonb)) as c(mode text, kind text, name text, hex text, position int);

  insert into public.design_theme_fonts (theme_id, role, font_id, fallback)
  select v_id, f.role, f.font_id, f.fallback
  from jsonb_to_recordset(coalesce(p_theme->'fonts', '[]'::jsonb)) as f(role text, font_id uuid, fallback text);

  -- Les 12 rôles en clair ; en sombre, les 12 si la variante existe, aucune couleur sinon
  if (select count(*) from public.design_theme_colors where theme_id = v_id and mode = 'light' and kind = 'role') <> 12
     or (select count(*) from public.design_theme_colors where theme_id = v_id and mode = 'dark' and kind = 'role') <> 12 * v_dark::int
     or (not v_dark and exists (select 1 from public.design_theme_colors where theme_id = v_id and mode = 'dark')) then
    raise sqlstate 'PT400' using message = 'Il manque des couleurs : chaque rôle doit en avoir une.';
  end if;
  if (select count(*) from public.design_theme_colors where theme_id = v_id and kind = 'named') > 24 then
    raise sqlstate 'PT400' using message = '24 couleurs nommées au maximum.';
  end if;

  return v_id;
end;
$$;
revoke execute on function public.design_save_theme(jsonb) from public, anon;
grant execute on function public.design_save_theme(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Stockage : bucket public des polices
-- ---------------------------------------------------------------------------
-- Public : les applis liées chargent les fichiers sans compte (aucun appel à Google depuis le navigateur
-- des visiteurs). Écriture, liste et suppression réservées aux admins Flexdesign. 2 Mo max par fichier.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-fonts', 'design-fonts', true, 2097152, array['font/woff2', 'font/woff', 'font/ttf', 'font/otf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "design_fonts_bucket_admin_read" on storage.objects;
create policy "design_fonts_bucket_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_fonts_bucket_admin_insert" on storage.objects;
create policy "design_fonts_bucket_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_fonts_bucket_admin_update" on storage.objects;
create policy "design_fonts_bucket_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])))
  with check (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

drop policy if exists "design_fonts_bucket_admin_delete" on storage.objects;
create policy "design_fonts_bucket_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'design-fonts' and (select public.suite_has_app_role('flexdesign', array['admin'])));

-- =====================================================================
-- Moodboards : tableaux d'images de référence, personnels et partageables
-- =====================================================================
--
--   design_boards           Tableau : titre, description, propriétaire, lecture par toute l'équipe ou non.
--   design_board_members    Membres de l'équipe Flexdesign choisis par le propriétaire : lecture ou modification.
--   design_board_links      Lien public en lecture seule : jeton secret, visible du seul propriétaire.
--   design_board_items      Images posées sur la toile : fichier du bucket privé design-assets, taille
--                           d'origine, position (x, y), largeur affichée, ordre d'empilement, note.
--   design_board_access()   Accès du compte connecté à un tableau : 'owner', 'edit', 'read' ou null.
--   design_team()           Équipe Flexdesign (comptes et e-mails), pour choisir avec qui partager.
--   design_board_by_token() Tableau d'un lien public (visiteurs compris).
--
-- Droits : un tableau n'est visible que par son propriétaire et ceux avec qui il l'a partagé, et seulement
-- tant qu'ils ont un rôle Flexdesign. Être admin de Flexdesign ou super admin ne donne aucun accès aux
-- tableaux des autres. Le propriétaire seul change le titre, le partage et supprime le tableau ; les
-- membres en modification ajoutent, déplacent, annotent et retirent les images.

create table if not exists public.design_boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  team_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists design_boards_owner_id on public.design_boards (owner_id);

create table if not exists public.design_board_members (
  board_id uuid not null references public.design_boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists design_board_members_user_id on public.design_board_members (user_id);

create table if not exists public.design_board_links (
  board_id uuid primary key references public.design_boards (id) on delete cascade,
  -- 32 octets aléatoires en base64url, générés par le serveur
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.design_board_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.design_boards (id) on delete cascade,
  -- Chemin dans le bucket design-assets : <id du tableau>/<uuid>.<extension>, généré par Flexdesign
  path text not null unique check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png|gif)$'),
  mime text not null check (mime in ('image/webp', 'image/jpeg', 'image/png', 'image/gif')),
  width_px int not null check (width_px between 1 and 10000),
  height_px int not null check (height_px between 1 and 10000),
  x int not null default 0 check (x between 0 and 20000),
  y int not null default 0 check (y between 0 and 20000),
  w int not null default 320 check (w between 40 and 4000),
  z int not null default 0,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Le fichier est rangé dans le dossier de son tableau : un élément ne peut pas pointer vers celui d'un autre
  check (starts_with(path, board_id::text || '/'))
);
create index if not exists design_board_items_board_id on public.design_board_items (board_id);

-- ---------------------------------------------------------------------------
-- Fonctions d'accès (security definer : lisent les tableaux sans repasser par leurs règles)
-- ---------------------------------------------------------------------------

-- Compte de l'équipe Flexdesign : rôle dans app_roles ou super admin
create or replace function public.design_is_team_member(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_roles where user_id = p_user and app = 'flexdesign')
      or exists (select 1 from public.suite_super_admins where user_id = p_user)
$$;

create or replace function public.design_board_access(p_board uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_team boolean;
  v_edit boolean;
begin
  if auth.uid() is null or not public.suite_has_app_role('flexdesign', array['admin', 'staff']) then
    return null;
  end if;
  select b.owner_id, b.team_read into v_owner, v_team from public.design_boards b where b.id = p_board;
  if not found then
    return null;
  end if;
  if v_owner = auth.uid() then
    return 'owner';
  end if;
  select m.can_edit into v_edit from public.design_board_members m where m.board_id = p_board and m.user_id = auth.uid();
  if found then
    if v_edit then
      return 'edit';
    end if;
    return 'read';
  end if;
  if v_team then
    return 'read';
  end if;
  return null;
end;
$$;

-- Accès d'après le chemin d'un fichier du bucket design-assets (<id du tableau>/...)
create or replace function public.design_board_path_access(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.design_board_access(substring(p_name from '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/')::uuid)
$$;

-- Équipe Flexdesign, pour choisir les membres d'un tableau. Réservée à l'équipe Flexdesign.
create or replace function public.design_team()
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.suite_has_app_role('flexdesign', array['admin', 'staff']) then
    raise sqlstate 'PT403' using message = 'Réservé à l''équipe Flexdesign.';
  end if;
  return query
  select u.id, u.email::text
  from auth.users u
  where public.design_is_team_member(u.id)
  order by u.email;
end;
$$;

-- Tableau d'un lien public, avec ses images (chemins compris, pour le serveur seulement). Null si le jeton
-- est inconnu ou si le propriétaire n'a plus de rôle Flexdesign.
create or replace function public.design_board_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id,
    'title', b.title,
    'description', b.description,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'path', i.path, 'mime', i.mime, 'width_px', i.width_px, 'height_px', i.height_px,
        'x', i.x, 'y', i.y, 'w', i.w, 'z', i.z, 'note', i.note
      ) order by i.z, i.created_at)
      from public.design_board_items i where i.board_id = b.id
    ), '[]'::jsonb)
  )
  from public.design_board_links l
  join public.design_boards b on b.id = l.board_id
  where l.token = p_token and public.design_is_team_member(b.owner_id)
$$;

revoke execute on function public.design_is_team_member(uuid) from public, anon;
revoke execute on function public.design_board_access(uuid) from public, anon;
revoke execute on function public.design_board_path_access(text) from public, anon;
revoke execute on function public.design_team() from public, anon;
grant execute on function public.design_is_team_member(uuid) to authenticated;
grant execute on function public.design_board_access(uuid) to authenticated;
grant execute on function public.design_board_path_access(text) to authenticated;
grant execute on function public.design_team() to authenticated;
revoke execute on function public.design_board_by_token(text) from public;
grant execute on function public.design_board_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sécurité par ligne : rien pour les visiteurs (le lien public passe par design_board_by_token)
-- ---------------------------------------------------------------------------

alter table public.design_boards enable row level security;
alter table public.design_board_members enable row level security;
alter table public.design_board_links enable row level security;
alter table public.design_board_items enable row level security;

revoke all on public.design_boards, public.design_board_members, public.design_board_links, public.design_board_items from anon;

-- Propriétaire testé aussi directement : la fonction ne voit pas encore la ligne qu'une insertion renvoie
drop policy if exists "design_boards_select" on public.design_boards;
create policy "design_boards_select" on public.design_boards
  for select to authenticated
  using (
    (owner_id = (select auth.uid()) and (select public.suite_has_app_role('flexdesign', array['admin', 'staff'])))
    or public.design_board_access(id) is not null
  );
drop policy if exists "design_boards_insert" on public.design_boards;
create policy "design_boards_insert" on public.design_boards
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.suite_has_app_role('flexdesign', array['admin', 'staff'])));
drop policy if exists "design_boards_update" on public.design_boards;
create policy "design_boards_update" on public.design_boards
  for update to authenticated
  using (public.design_board_access(id) = 'owner')
  with check (public.design_board_access(id) = 'owner');
drop policy if exists "design_boards_delete" on public.design_boards;
create policy "design_boards_delete" on public.design_boards
  for delete to authenticated using (public.design_board_access(id) = 'owner');
-- Le propriétaire ne change pas : seuls titre, description et lecture par l'équipe se modifient
revoke update on public.design_boards from authenticated;
grant update (title, description, team_read, updated_at) on public.design_boards to authenticated;

-- Membres : le propriétaire gère la liste ; chaque membre voit sa propre ligne
drop policy if exists "design_board_members_select" on public.design_board_members;
create policy "design_board_members_select" on public.design_board_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.design_board_access(board_id) = 'owner');
drop policy if exists "design_board_members_insert" on public.design_board_members;
create policy "design_board_members_insert" on public.design_board_members
  for insert to authenticated
  with check (
    public.design_board_access(board_id) = 'owner'
    and user_id <> (select auth.uid())
    and public.design_is_team_member(user_id)
  );
drop policy if exists "design_board_members_update" on public.design_board_members;
create policy "design_board_members_update" on public.design_board_members
  for update to authenticated
  using (public.design_board_access(board_id) = 'owner')
  with check (public.design_board_access(board_id) = 'owner');
drop policy if exists "design_board_members_delete" on public.design_board_members;
create policy "design_board_members_delete" on public.design_board_members
  for delete to authenticated using (public.design_board_access(board_id) = 'owner');
revoke update on public.design_board_members from authenticated;
grant update (can_edit) on public.design_board_members to authenticated;

-- Lien public : propriétaire seulement (les membres ne voient pas le jeton)
drop policy if exists "design_board_links_owner" on public.design_board_links;
create policy "design_board_links_owner" on public.design_board_links
  for all to authenticated
  using (public.design_board_access(board_id) = 'owner')
  with check (public.design_board_access(board_id) = 'owner');

-- Images : lecture pour tout accès, écriture pour le propriétaire et les membres en modification
drop policy if exists "design_board_items_select" on public.design_board_items;
create policy "design_board_items_select" on public.design_board_items
  for select to authenticated using (public.design_board_access(board_id) is not null);
drop policy if exists "design_board_items_insert" on public.design_board_items;
create policy "design_board_items_insert" on public.design_board_items
  for insert to authenticated
  with check (public.design_board_access(board_id) in ('owner', 'edit') and created_by = (select auth.uid()));
drop policy if exists "design_board_items_update" on public.design_board_items;
create policy "design_board_items_update" on public.design_board_items
  for update to authenticated
  using (public.design_board_access(board_id) in ('owner', 'edit'))
  with check (public.design_board_access(board_id) in ('owner', 'edit'));
drop policy if exists "design_board_items_delete" on public.design_board_items;
create policy "design_board_items_delete" on public.design_board_items
  for delete to authenticated using (public.design_board_access(board_id) in ('owner', 'edit'));
-- Le fichier et le tableau d'une image ne changent pas : seuls position, taille, ordre et note se modifient
revoke update on public.design_board_items from authenticated;
grant update (x, y, w, z, note) on public.design_board_items to authenticated;

-- ---------------------------------------------------------------------------
-- Stockage : bucket privé des images des moodboards
-- ---------------------------------------------------------------------------
-- Privé : chaque fichier suit les droits de son tableau (dossier <id du tableau>/). Les pages de Flexdesign
-- reçoivent les images par une route /api du même site. 5 Mo max, images uniquement (pas de SVG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-assets', 'design-assets', false, 5242880, array['image/webp', 'image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "design_assets_bucket_read" on storage.objects;
create policy "design_assets_bucket_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'design-assets' and public.design_board_path_access(name) is not null);

drop policy if exists "design_assets_bucket_insert" on storage.objects;
create policy "design_assets_bucket_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'design-assets' and public.design_board_path_access(name) in ('owner', 'edit'));

drop policy if exists "design_assets_bucket_delete" on storage.objects;
create policy "design_assets_bucket_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'design-assets' and public.design_board_path_access(name) in ('owner', 'edit'));
