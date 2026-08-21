function getRequiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name, fallback = "") {
  const value = String(process.env[name] ?? "").trim();
  return value || fallback;
}

module.exports = {
  getOptionalEnv,
  getRequiredEnv,
};
