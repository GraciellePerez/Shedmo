-- Normalize the deployed title rule without editing the original listings
-- migration. This is intentionally the same 3–120 trimmed-character contract
-- enforced by the Expo form and listing repository.

alter table public.listings
  drop constraint if exists listings_title_check;

alter table public.listings
  add constraint listings_title_check
  check (char_length(btrim(title)) between 3 and 120);

comment on constraint listings_title_check on public.listings is
  'Listing titles must contain 3 to 120 characters after surrounding whitespace is trimmed.';
