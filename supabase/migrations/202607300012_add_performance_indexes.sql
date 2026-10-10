-- Composite indexes for the actual seller-profile and inbox query shapes.
-- This migration changes no policies, grants, constraints, or visibility.

-- Public seller profiles filter by seller and active status, then page in a
-- stable newest-first order.
create index if not exists listings_seller_status_created_id_idx
  on public.listings (seller_id, status, created_at desc, id desc);

-- Inbox queries filter either participant column and order recent
-- conversations by last activity with deterministic tie breakers.
create index if not exists conversations_buyer_activity_idx
  on public.conversations (
    buyer_id,
    last_message_at desc nulls last,
    created_at desc,
    id desc
  );

create index if not exists conversations_seller_activity_idx
  on public.conversations (
    seller_id,
    last_message_at desc nulls last,
    created_at desc,
    id desc
  );

