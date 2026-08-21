const { createClient } = require("@supabase/supabase-js");
const { getOptionalEnv, getRequiredEnv } = require("./env");
const {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} = require("./public-config");

let cachedServiceClient = null;
let cachedReadClient = null;

function getSupabaseReadClient() {
  if (cachedReadClient) return cachedReadClient;
  cachedReadClient = createClient(
    getOptionalEnv("SUPABASE_URL", PUBLIC_SUPABASE_URL),
    getOptionalEnv("SUPABASE_PUBLISHABLE_KEY", PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  return cachedReadClient;
}

function getSupabaseAdminClient() {
  if (cachedServiceClient) return cachedServiceClient;
  cachedServiceClient = createClient(
    getOptionalEnv("SUPABASE_URL", PUBLIC_SUPABASE_URL),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
  return cachedServiceClient;
}

module.exports = {
  getSupabaseAdminClient,
  getSupabaseReadClient,
};
