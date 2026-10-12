-- TempoOps schema
create extension if not exists "pgcrypto";

do $$ begin
  create type public.activity_status as enum ('draft', 'ready', 'analyzing', 'done', 'error');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  prompt text not null default '',
  status public.activity_status not null default 'draft',
  analysis jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_videos (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  original_name text not null,
  stored_name text not null,
  storage_path text not null,
  mime_type text not null,
  size bigint not null check (size >= 0),
  uploaded_at timestamptz not null default now()
);

create index if not exists activities_updated_at_idx
  on public.activities (updated_at desc);

create index if not exists activity_videos_activity_id_idx
  on public.activity_videos (activity_id);

alter table public.activities enable row level security;
alter table public.activity_videos enable row level security;

-- API access only via service role from Next.js (no public anon policies)

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on table public.activities to postgres, service_role;
grant all on table public.activity_videos to postgres, service_role;
grant select, insert, update, delete on table public.activities to authenticated;
grant select, insert, update, delete on table public.activity_videos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'activity-videos',
  'activity-videos',
  true,
  524288000,
  array['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/3gpp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read activity videos" on storage.objects;
create policy "Public read activity videos"
  on storage.objects for select
  to public
  using (bucket_id = 'activity-videos');

drop policy if exists "Service role manage activity videos" on storage.objects;
create policy "Service role manage activity videos"
  on storage.objects for all
  to service_role
  using (bucket_id = 'activity-videos')
  with check (bucket_id = 'activity-videos');
