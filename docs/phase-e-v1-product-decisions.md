# Phase E V1 product decisions

## Sold listing cards

Public seller profiles retain a verified sold-listing count but do not expose sold listing cards in V1. A sold listing can contain item photos, location context, and description details that a seller may not expect to remain browsable indefinitely. The count supplies useful trust evidence without exposing buyer/order information or creating a permanent sold-item catalog. A future privacy setting can revisit this deliberately.

## Shared listing links

The native share sheet continues to share a listing title and price. Universal links and an app-not-installed web fallback are deferred until Shedmo has a real public web domain and verified Android App Links configuration. No placeholder production URL or misleading custom-scheme fallback is used.

## Notification delivery

`marketplace_notification_events` is a private, service-role-only outbox. Phase E records sanitized, idempotent logical events but does not send production push notifications from the outbox. New-message notifications continue through the existing messaging notification trigger to avoid duplicate streams.
