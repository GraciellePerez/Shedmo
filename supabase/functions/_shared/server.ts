import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.111.0";
import Stripe from "npm:stripe@22.4.0";

interface ServerClients {
  admin: SupabaseClient;
  stripe: Stripe;
}

const requiredEnvironment = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};

export const createSupabaseAdminClient = (): SupabaseClient => {
  const supabaseUrl = requiredEnvironment("SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

export const createSupabaseUserClient = (request: Request): SupabaseClient => {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) throw new Error("AUTH_REQUIRED");
  return createClient(
    requiredEnvironment("SUPABASE_URL"),
    requiredEnvironment("SUPABASE_ANON_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    },
  );
};

export const createStripeClient = (): Stripe =>
  new Stripe(requiredEnvironment("STRIPE_SECRET_KEY"));

export const createServerClients = (): ServerClients => {
  return {
    admin: createSupabaseAdminClient(),
    stripe: createStripeClient(),
  };
};

export const requireAuthenticatedUser = async (
  request: Request,
  admin: SupabaseClient,
  onStage?: (
    stage: "jwt_authentication" | "authenticated_user_lookup",
    event: "before" | "after",
  ) => void,
): Promise<User> => {
  onStage?.("jwt_authentication", "before");
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) throw new Error("AUTH_REQUIRED");
  onStage?.("jwt_authentication", "after");

  onStage?.("authenticated_user_lookup", "before");
  const { data, error } = await admin.auth.getUser(match[1]);
  if (error || !data.user) throw new Error("AUTH_REQUIRED");
  onStage?.("authenticated_user_lookup", "after");
  return data.user;
};
