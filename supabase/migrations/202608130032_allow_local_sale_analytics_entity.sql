-- Forward-only repair after runtime validation of migration 031.
alter table public.marketplace_analytics_events
  drop constraint marketplace_analytics_events_entity_type_check;
alter table public.marketplace_analytics_events
  add constraint marketplace_analytics_events_entity_type_check
  check(entity_type is null or entity_type in('listing','order','conversation','review','report','seller','local_sale'));
