-- Cyclo.ia: remove tabelas do schema industrial antigo (não usadas)
-- Mantém: companies, activities, activity_videos

drop table if exists public.production_cycle_steps cascade;
drop table if exists public.production_cycles cascade;
drop table if exists public.activity_engine_runs cascade;
drop table if exists public.detected_events cascade;
drop table if exists public.video_annotations cascade;
drop table if exists public.video_clips cascade;
drop table if exists public.cv_runs cascade;
drop table if exists public.models cascade;
drop table if exists public.training_jobs cascade;
drop table if exists public.datasets cascade;
drop table if exists public.training_videos cascade;
drop table if exists public.cameras cascade;
drop table if exists public.edge_sync_receipts cascade;
drop table if exists public.edge_agents cascade;
drop table if exists public.activity_steps cascade;
drop table if exists public.activity_rois cascade;
drop table if exists public.workstations cascade;
drop table if exists public.production_lines cascade;
drop table if exists public.sectors cascade;
drop table if exists public.plants cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.profiles cascade;

-- Colunas de atividades que apontavam para hierarquia industrial removida
alter table public.activities drop column if exists plant_id;
alter table public.activities drop column if exists sector_id;
alter table public.activities drop column if exists line_id;
alter table public.activities drop column if exists workstation_id;

-- Enums órfãos
do $$
declare
  enum_name text;
begin
  foreach enum_name in array array[
    'activity_engine_run_status',
    'annotation_type',
    'camera_status',
    'cv_run_status',
    'dataset_status',
    'edge_status',
    'model_status',
    'roi_shape',
    'training_job_status',
    'user_role',
    'video_status'
  ]
  loop
    execute format('drop type if exists public.%I cascade', enum_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
