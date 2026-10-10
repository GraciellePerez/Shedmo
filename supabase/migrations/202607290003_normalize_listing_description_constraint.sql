-- Forward-only repair for environments where listings_description_check may
-- differ from the checked-in Phase 3 definition. This intentionally reasserts
-- the documented 10–5000 character rule without editing applied migrations.

alter table public.listings
  drop constraint if exists listings_description_check;

alter table public.listings
  add constraint listings_description_check
  check (char_length(btrim(description)) between 10 and 5000);

