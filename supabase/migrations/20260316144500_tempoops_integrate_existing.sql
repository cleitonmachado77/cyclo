-- Integra TempoOps ao schema industrial existente
alter table public.activities
  add column if not exists gemini_prompt text not null default '',
  add column if not exists gemini_analysis jsonb,
  add column if not exists gemini_error text,
  add column if not exists gemini_status text not null default 'draft';

do $$ begin
  alter table public.activities
    add constraint activities_gemini_status_check
    check (gemini_status in ('draft', 'ready', 'analyzing', 'done', 'error'));
exception
  when duplicate_object then null;
end $$;

create index if not exists activities_gemini_status_idx
  on public.activities (gemini_status);

create index if not exists activities_updated_at_idx
  on public.activities (updated_at desc);

-- activity_videos já criada e ligada a activities
alter table public.activity_videos enable row level security;

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

notify pgrst, 'reload schema';
