const { createClient } = require("@supabase/supabase-js");
const { getRequiredEnv } = require("./env");

let cachedServiceClient = null;

function getSupabaseAdminClient() {
  if (cachedServiceClient) return cachedServiceClient;
  cachedServiceClient = createClient(
    getRequiredEnv("SUPABASE_URL"),
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
};
