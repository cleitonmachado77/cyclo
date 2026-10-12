-- Esteira de análise Cyclo.ia
create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'error', 'partial')),
  source text not null default 'manual'
    check (source in ('manual', 'camera', 'api')),
  prompt text not null default '',
  consolidated_report jsonb,
  error_message text,
  retention_hours integer not null default 72,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.analysis_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.analysis_runs(id) on delete cascade,
  video_id uuid not null references public.activity_videos(id) on delete cascade,
  sort_order integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'error', 'skipped')),
  result jsonb,
  error_message text,
  model text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists analysis_runs_activity_id_idx on public.analysis_runs(activity_id, created_at desc);
create index if not exists analysis_items_run_id_idx on public.analysis_items(run_id, sort_order);
create index if not exists analysis_items_status_idx on public.analysis_items(status);

alter table public.activity_videos
  add column if not exists source text not null default 'manual',
  add column if not exists expires_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists activity_videos_expires_at_idx
  on public.activity_videos(expires_at)
  where deleted_at is null;

alter table public.analysis_runs enable row level security;
alter table public.analysis_items enable row level security;

grant all on table public.analysis_runs to postgres, service_role;
grant all on table public.analysis_items to postgres, service_role;

notify pgrst, 'reload schema';
