-- Correct the primary-key constraint name used by the D3.1 payout claim.
do $$ begin
  execute replace(
    pg_get_functiondef('public.claim_seller_payout(uuid,uuid)'::regprocedure),
    'seller_payout_releases_order_id_key',
    'seller_payout_releases_pkey'
  );
end $$;
