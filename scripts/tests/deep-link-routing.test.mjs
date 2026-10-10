import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAppDeepLink,
  navigationForDeepLink,
} from "../../src/features/auth/deepLinkRouting.ts";

const assertEquals = (actual, expected, label) => assert.equal(actual, expected, label);

test("cold Stripe return with session opens payout return", () => {
  const link = classifyAppDeepLink(
    "shedmo:///settings/payouts/return",
  );
  assertEquals(
    navigationForDeepLink(link, true),
    "/settings/payouts/return",
    "route",
  );
});

test("warm and repeated Stripe returns remain deterministic", () => {
  const raw = "shedmo:///settings/payouts/return";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertEquals(
      navigationForDeepLink(classifyAppDeepLink(raw), true),
      "/settings/payouts/return",
      `attempt ${attempt}`,
    );
  }
});

test("Stripe return overrides a previously open reset route", () => {
  const link = classifyAppDeepLink(
    "shedmo:///settings/payouts/return",
  );
  assertEquals(
    navigationForDeepLink(link, true),
    "/settings/payouts/return",
    "route",
  );
});

test("Stripe return without a session enters protected auth", () => {
  const link = classifyAppDeepLink(
    "shedmo:///settings/payouts/return",
  );
  assertEquals(navigationForDeepLink(link, false), "/(auth)", "route");
});

test("Stripe refresh opens payout refresh", () => {
  const link = classifyAppDeepLink(
    "shedmo:///settings/payouts/refresh",
  );
  assertEquals(
    navigationForDeepLink(link, true),
    "/settings/payouts/refresh",
    "route",
  );
});

test("verified Supabase recovery callback opens reset password", () => {
  const link = classifyAppDeepLink(
    "shedmo://reset-password#type=recovery&access_token=safe-test&refresh_token=safe-test",
  );
  assertEquals(link.kind, "recovery", "kind");
  assertEquals(navigationForDeepLink(link, true), "/reset-password", "route");
});

test("ordinary sign-in callback cannot open reset password", () => {
  const link = classifyAppDeepLink(
    "shedmo://reset-password#type=signup&access_token=safe-test&refresh_token=safe-test",
  );
  assertEquals(link.kind, "invalid-recovery", "kind");
  assertEquals(navigationForDeepLink(link, true), null, "route");
});

test("bare and malformed custom links cannot open reset password", () => {
  assertEquals(
    classifyAppDeepLink("shedmo://reset-password").kind,
    "invalid-recovery",
    "bare reset link",
  );
  assertEquals(
    classifyAppDeepLink("not a url").kind,
    "other",
    "malformed link",
  );
});

test("verified signup callback establishes normal auth without opening recovery", () => {
  const link = classifyAppDeepLink(
    "shedmo://auth/callback#type=signup&access_token=safe-test&refresh_token=safe-test",
  );
  assertEquals(link.kind, "auth", "kind");
  assertEquals(navigationForDeepLink(link, false), "/(auth)", "logged-out routing while session establishes");
  assertEquals(navigationForDeepLink(link, true), "/(tabs)", "authenticated routing");
});

test("recovery tokens cannot open the normal auth callback", () => {
  const link = classifyAppDeepLink(
    "shedmo://auth/callback#type=recovery&access_token=safe-test&refresh_token=safe-test",
  );
  assertEquals(link.kind, "other", "kind");
  assertEquals(navigationForDeepLink(link, false), null, "route");
});

test("malformed auth callback fails closed", () => {
  assertEquals(
    classifyAppDeepLink("shedmo://auth/callback#type=signup").kind,
    "other",
    "missing tokens",
  );
});
