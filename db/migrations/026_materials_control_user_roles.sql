-- 026_materials_control_user_roles.sql
-- Authentic Materials Control (HMC) User, Department Group & Store Rights Architecture
-- Directly models HMC BESTELLER, KSTRIGHTS (KGT_ALLKST), and RIGHTS tables.

-- 1. Drop rigid legacy check constraints on store_id
alter table users drop constraint if exists users_check;
alter table users drop constraint if exists users_check1;
alter table users drop constraint if exists users_role_check;

-- 2. Add HMC Department Groups, All-Stores Access flag (KGT_ALLKST), C/S Store Filter, and Document Visibility
alter table users
  add column if not exists department_group text not null default 'custom'
    check (department_group in ('controller', 'storekeeper', 'chef', 'bar', 'purchasing', 'management', 'admin', 'custom')),
  add column if not exists all_stores_access boolean not null default false,
  add column if not exists assigned_store_ids jsonb not null default '[]'::jsonb,
  add column if not exists document_visibility text not null default 'department'
    check (document_visibility in ('all', 'department', 'own'));

-- 3. Backfill existing users according to HMC rules
-- Admin users get full property-wide all-stores access
update users
set department_group = 'admin',
    all_stores_access = true,
    document_visibility = 'all'
where role = 'admin';

-- Store users get assigned their current store_id into assigned_store_ids
update users u
set department_group = case 
      when s.kind = 'kitchen' then 'chef'
      when s.kind = 'bar' then 'bar'
      when s.kind = 'main' then 'storekeeper'
      else 'custom'
    end,
    all_stores_access = false,
    assigned_store_ids = case when u.store_id is not null then jsonb_build_array(u.store_id) else '[]'::jsonb end,
    document_visibility = 'department'
from stores s
where u.store_id = s.id and u.role = 'store_user';
