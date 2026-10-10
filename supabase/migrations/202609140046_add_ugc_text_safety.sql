-- Local only. Deterministic, deliberately narrow V1 rules; not semantic or image moderation.
-- No backfill, deletion, RLS changes, or logging of user content.
begin;

create function public.ugc_text_is_prohibited_v1(p_text text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  with normalized as (
    select regexp_replace(lower(normalize(translate(coalesce(p_text, ''),
      chr(8203) || chr(8204) || chr(8205) || chr(65279), ''), NFKC)),
      '[^[:alnum:]]+', ' ', 'g') as value
  )
  select value ~ '\m(i will|i am going to|im going to|i m going to) (kill|murder|rape) you\M'
    or value ~ '\m(go kill yourself|you should kill yourself)\M'
    or value ~ '\m(selling|sell|for sale) (stolen (tools|equipment|phones|bikes)|counterfeit (tools|designer bags|currency)|cocaine|heroin|methamphetamine)\M'
    or value ~ '\m(stolen (tools|equipment|phones|bikes)|counterfeit (tools|designer bags|currency)|cocaine|heroin|methamphetamine) for sale\M'
    or value ~ '\m(selling|for sale|send me|buying) (child pornography|child sexual abuse material)\M'
    or value ~ '\m(begin (rsa |ec |openssh )?private key)\M'
    or coalesce(p_text, '') ~ '\m(sk_live_|sb_secret_)[A-Za-z0-9_-]{20,}'
  from normalized;
$$;
revoke all on function public.ugc_text_is_prohibited_v1(text) from public;
grant execute on function public.ugc_text_is_prohibited_v1(text) to anon, authenticated, service_role;

create function public.enforce_ugc_text_safety_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_text text;
begin
  -- Validate new/changed UGC, not unrelated moderation/status/account operations
  -- on historical content. Publishing drafts or restoring archived/expired listings
  -- rechecks text; releasing an unchanged reservation must not interrupt checkout.
  if tg_table_name = 'listings' then
    if tg_op = 'UPDATE' and (new.title,new.description,new.brand,new.category) is not distinct from
      (old.title,old.description,old.brand,old.category) and not (new.status='active' and old.status in ('draft','archived','expired')) then return new; end if;
    v_text := concat_ws(' ',new.title,new.description,new.brand,new.category);
  elsif tg_table_name = 'messages' then
    if tg_op = 'UPDATE' and new.body is not distinct from old.body then return new; end if;
    v_text := new.body;
  elsif tg_table_name = 'marketplace_reviews' then
    if tg_op = 'UPDATE' and new.body is not distinct from old.body then return new; end if;
    v_text := new.body;
  elsif tg_table_name = 'profiles' then
    if tg_op = 'UPDATE' and (new.display_name,new.username,new.bio) is not distinct from
      (old.display_name,old.username,old.bio) then return new; end if;
    v_text := concat_ws(' ',new.display_name,new.username,new.bio);
  else
    raise exception 'Unsupported content type';
  end if;
  if public.ugc_text_is_prohibited_v1(v_text) then
    raise exception using errcode = 'P0001', message = 'SHEDMO_CONTENT_NOT_ALLOWED';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_ugc_text_safety_v1() from public, anon, authenticated;

create trigger listings_ugc_text_safety before insert or update on public.listings
for each row execute function public.enforce_ugc_text_safety_v1();
create trigger messages_ugc_text_safety before insert or update on public.messages
for each row execute function public.enforce_ugc_text_safety_v1();
create trigger reviews_ugc_text_safety before insert or update on public.marketplace_reviews
for each row execute function public.enforce_ugc_text_safety_v1();
create trigger profiles_ugc_text_safety before insert or update on public.profiles
for each row execute function public.enforce_ugc_text_safety_v1();
commit;
