grant select (id, buyer_id, seller_id)
on table public.conversations to service_role;

grant select (id, conversation_id, attachment_path)
on table public.messages to service_role;
