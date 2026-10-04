-- Postgres grants EXECUTE on new functions to PUBLIC. Revoke from API roles
-- so only service_role can call these SECURITY DEFINER queue functions.

revoke all on function public.ingest_inbound_event(uuid, text, text, text, timestamptz, bytea) from public, anon, authenticated;
revoke all on function public.reserve_provider_operation(uuid, text, text, text, text, integer, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_provider_operation(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_outbox_message(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_outbox_messages(text, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_outbox_sent(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_outbox_uncertain(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_bridge_runtime_state(text) from public, anon, authenticated;
revoke all on function public.put_bridge_runtime_state(text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_bridge_runtime_state(text) from public, anon, authenticated;
revoke all on function public.claim_bridge_inbound(text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_bridge_inbound(text, uuid) from public, anon, authenticated;
revoke all on function public.release_bridge_inbound(text, uuid) from public, anon, authenticated;
revoke all on function public.enqueue_bridge_outbox_message(text, text, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.ingest_inbound_event(uuid, text, text, text, timestamptz, bytea) to service_role;
grant execute on function public.reserve_provider_operation(uuid, text, text, text, text, integer, integer, uuid, uuid) to service_role;
grant execute on function public.finalize_provider_operation(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.enqueue_outbox_message(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.claim_outbox_messages(text, integer, integer) to service_role;
grant execute on function public.mark_outbox_sent(uuid, uuid, text) to service_role;
grant execute on function public.mark_outbox_uncertain(uuid, uuid, text) to service_role;
grant execute on function public.get_bridge_runtime_state(text) to service_role;
grant execute on function public.put_bridge_runtime_state(text, jsonb) to service_role;
grant execute on function public.delete_bridge_runtime_state(text) to service_role;
grant execute on function public.claim_bridge_inbound(text, timestamptz, integer, integer) to service_role;
grant execute on function public.complete_bridge_inbound(text, uuid) to service_role;
grant execute on function public.release_bridge_inbound(text, uuid) to service_role;
grant execute on function public.enqueue_bridge_outbox_message(text, text, text, text, timestamptz) to service_role;
