-- 0009_disable_public_password_reset_rpc.sql
-- SECURITY HARDENING: Drop & Revoke Public Password Reset RPC Function

-- 1. Revoke execution permissions from anon, authenticated, and public
revoke execute on function public.reset_user_password(text, text) from anon;
revoke execute on function public.reset_user_password(text, text) from authenticated;
revoke execute on function public.reset_user_password(text, text) from public;

-- 2. Completely drop the public RPC function to eliminate account takeover vulnerability
drop function if exists public.reset_user_password(text, text);
