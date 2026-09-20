-- 015_user_permissions.sql
-- Add granular JSONB permissions to users table to support exact role customization

alter table users
  add column permissions jsonb not null default '[]'::jsonb;
