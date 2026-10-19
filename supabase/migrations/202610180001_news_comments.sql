-- Apply once with Supabase migrations or the SQL Editor as the database owner.
-- Article IDs are the existing stable source.id, never the changing issue ID.
begin;

create schema if not exists community_private;
revoke all on schema community_private from public, anon, authenticated;

create table public.community_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 30),
  created_at timestamptz not null default now()
);

create table public.news_comments (
  id uuid primary key default gen_random_uuid(),
  article_id text not null check (article_id ~ '^article_[0-9a-f]{20}$'),
  parent_id uuid references public.news_comments(id) on delete restrict,
  author_id uuid references public.community_profiles(user_id) on delete set null,
  body text not null check (char_length(body) <= 2000),
  status text not null default 'published' check (status in ('published', 'hidden', 'deleted')),
  content_kind text not null default 'reader_opinion' check (content_kind = 'reader_opinion'),
  mentions_evan boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'deleted' and body = '') or (status <> 'deleted' and char_length(btrim(body)) >= 1))
);
create index news_comments_article_latest on public.news_comments(article_id, created_at desc, id desc);
create index news_comments_parent on public.news_comments(parent_id) where parent_id is not null;
create index news_comments_author_recent on public.news_comments(author_id, created_at desc);

create table public.news_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.news_comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'misinformation', 'privacy', 'other')),
  detail text not null default '' check (char_length(detail) <= 500),
  evidence text not null check (char_length(evidence) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);
create index news_comment_reports_pending on public.news_comment_reports(created_at) where status = 'pending';

create table community_private.write_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('create', 'edit', 'delete', 'report')),
  created_at timestamptz not null default now()
);
create index community_write_events_user_time on community_private.write_events(user_id, created_at desc);

create table community_private.moderation_log (
  id bigint generated always as identity primary key,
  comment_id uuid not null references public.news_comments(id),
  moderator_id uuid,
  reason text not null,
  old_status text not null,
  new_status text not null,
  created_at timestamptz not null default now()
);

alter table public.community_profiles enable row level security;
alter table public.news_comments enable row level security;
alter table public.news_comment_reports enable row level security;
alter table community_private.write_events enable row level security;
alter table community_private.moderation_log enable row level security;
revoke all on public.community_profiles, public.news_comments, public.news_comment_reports from public, anon, authenticated;
revoke all on all tables in schema community_private from public, anon, authenticated;
revoke all on all sequences in schema community_private from public, anon, authenticated;
grant select on public.community_profiles, public.news_comments to anon, authenticated;
grant select on public.news_comment_reports to authenticated;
grant all on public.community_profiles, public.news_comments, public.news_comment_reports to service_role;

create policy "Public pseudonyms contain no email or private account fields"
  on public.community_profiles for select to anon, authenticated using (true);
create policy "Public reads never include hidden comments or deleted text"
  on public.news_comments for select to anon, authenticated
  using (status = 'published' or (status = 'deleted' and body = ''));
create policy "Only trusted app metadata grants report access"
  on public.news_comment_reports for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
-- There are deliberately no INSERT, UPDATE, or DELETE policies/grants for clients.
-- All writes pass the RPC checks below. RLS alone cannot enforce a rate limit.

create function community_private.require_member(p_action text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := auth.uid();
  last_write timestamptz;
  count_hour bigint;
  cooldown interval;
  hourly_limit integer;
begin
  if member_id is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or not exists (select 1 from auth.users where id = member_id and email_confirmed_at is not null
      and (banned_until is null or banned_until < now())) then
    raise exception 'EVAN_LOGIN_REQUIRED' using errcode = '42501';
  end if;
  -- Serializes every mutation for this account, including concurrent requests.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member_id::text, 0));
  if p_action not in ('create', 'edit', 'delete', 'report') then
    raise exception 'EVAN_INVALID_ACTION' using errcode = '22023';
  end if;
  cooldown := case p_action when 'create' then interval '15 seconds' when 'report' then interval '10 seconds' else interval '5 seconds' end;
  hourly_limit := case p_action when 'create' then 20 when 'report' then 10 else 30 end;
  select max(created_at), count(*) into last_write, count_hour
    from community_private.write_events where user_id = member_id and action = p_action and created_at > now() - interval '1 hour';
  if last_write > now() - cooldown or count_hour >= hourly_limit
    or (select count(*) from community_private.write_events where user_id = member_id and created_at > now() - interval '1 day') >= 100 then
    raise exception 'EVAN_RATE_LIMIT' using errcode = 'P0001';
  end if;
  return member_id;
end;
$$;

create function community_private.valid_body(p_body text) returns text
language plpgsql set search_path = '' as $$
declare clean_body text := btrim(p_body); link_count integer;
begin
  if clean_body is null or char_length(clean_body) not between 1 and 2000
    or clean_body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'EVAN_INVALID_BODY' using errcode = '22023';
  end if;
  select count(*) into link_count from pg_catalog.regexp_matches(clean_body, '(https?://|www[.])', 'gi');
  if link_count > 3 then raise exception 'EVAN_INVALID_LINK_COUNT' using errcode = '22023'; end if;
  return clean_body;
end;
$$;

create function public.create_news_comment(p_article_id text, p_body text, p_parent_id uuid default null, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := community_private.require_member('create');
  clean_body text := community_private.valid_body(p_body);
  clean_name text := nullif(btrim(p_display_name), '');
  result_id uuid;
begin
  if p_article_id is null or p_article_id !~ '^article_[0-9a-f]{20}$' then
    raise exception 'EVAN_INVALID_ARTICLE' using errcode = '22023';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.news_comments where id = p_parent_id and article_id = p_article_id and parent_id is null and status = 'published'
  ) then raise exception 'EVAN_INVALID_PARENT' using errcode = '22023'; end if;
  if exists (select 1 from public.news_comments where author_id = member_id and lower(btrim(body)) = lower(clean_body)
    and created_at > now() - interval '1 day') then
    raise exception 'EVAN_DUPLICATE' using errcode = '23505';
  end if;
  if clean_name is not null and (char_length(clean_name) not between 2 and 30 or clean_name ~ '[[:cntrl:]]'
    or lower(clean_name) ~ '^(evan|admin|administrator|관리자|운영자)$') then
    raise exception 'EVAN_INVALID_NAME' using errcode = '22023';
  end if;
  insert into public.community_profiles(user_id, display_name)
    values (member_id, coalesce(clean_name, '독자-' || left(member_id::text, 6)))
    on conflict (user_id) do update set display_name = coalesce(clean_name, public.community_profiles.display_name);
  insert into public.news_comments(article_id, parent_id, author_id, body, mentions_evan)
    values (p_article_id, p_parent_id, member_id, clean_body, clean_body ~* '@evan\M') returning id into result_id;
  insert into community_private.write_events(user_id, action) values (member_id, 'create');
  return result_id;
end;
$$;

create function public.edit_news_comment(p_comment_id uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare member_id uuid := community_private.require_member('edit'); clean_body text := community_private.valid_body(p_body); existing public.news_comments;
begin
  select * into existing from public.news_comments where id = p_comment_id for update;
  if not found or existing.status <> 'published' then raise exception 'EVAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if existing.author_id is distinct from member_id then raise exception 'EVAN_NOT_OWNER' using errcode = '42501'; end if;
  update public.news_comments set body = clean_body, mentions_evan = clean_body ~* '@evan\M', updated_at = now() where id = p_comment_id;
  insert into community_private.write_events(user_id, action) values (member_id, 'edit');
end;
$$;

create function public.delete_news_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare member_id uuid := community_private.require_member('delete'); existing public.news_comments;
begin
  select * into existing from public.news_comments where id = p_comment_id for update;
  if not found or existing.status = 'deleted' then raise exception 'EVAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if existing.author_id is distinct from member_id then raise exception 'EVAN_NOT_OWNER' using errcode = '42501'; end if;
  update public.news_comments set body = '', status = 'deleted', mentions_evan = false, updated_at = now() where id = p_comment_id;
  insert into community_private.write_events(user_id, action) values (member_id, 'delete');
end;
$$;

create function public.report_news_comment(p_comment_id uuid, p_reason text, p_detail text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare member_id uuid := community_private.require_member('report'); target_body text;
begin
  if p_reason is null or p_reason not in ('spam', 'abuse', 'misinformation', 'privacy', 'other')
    or p_detail is null or char_length(p_detail) > 500 or p_detail ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'EVAN_INVALID_REPORT' using errcode = '22023';
  end if;
  select body into target_body from public.news_comments where id = p_comment_id and status = 'published';
  if not found then raise exception 'EVAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.news_comment_reports where comment_id = p_comment_id and reporter_id = member_id) then
    raise exception 'EVAN_DUPLICATE' using errcode = '23505';
  end if;
  insert into public.news_comment_reports(comment_id, reporter_id, reason, detail, evidence)
    values (p_comment_id, member_id, p_reason, btrim(p_detail), target_body);
  insert into community_private.write_events(user_id, action) values (member_id, 'report');
  -- Reports never auto-hide: a group of accounts must not censor another reader.
end;
$$;

create function public.moderate_news_comment(p_comment_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare existing public.news_comments;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'EVAN_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('hidden', 'published') or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'EVAN_INVALID_MODERATION' using errcode = '22023';
  end if;
  select * into existing from public.news_comments where id = p_comment_id for update;
  if not found or existing.status = 'deleted' then raise exception 'EVAN_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.news_comments set status = p_status, updated_at = now() where id = p_comment_id;
  update public.news_comment_reports set status = 'reviewed' where comment_id = p_comment_id and status = 'pending';
  insert into community_private.moderation_log(comment_id, moderator_id, reason, old_status, new_status)
    values (p_comment_id, auth.uid(), btrim(p_reason), existing.status, p_status);
end;
$$;

revoke all on all functions in schema community_private from public, anon, authenticated;
revoke all on function public.create_news_comment(text, text, uuid, text), public.edit_news_comment(uuid, text),
  public.delete_news_comment(uuid), public.report_news_comment(uuid, text, text), public.moderate_news_comment(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_news_comment(text, text, uuid, text), public.edit_news_comment(uuid, text),
  public.delete_news_comment(uuid), public.report_news_comment(uuid, text, text) to authenticated;
grant execute on function public.moderate_news_comment(uuid, text, text) to authenticated, service_role;

commit;
