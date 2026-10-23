// Muat .env.local / .env (seperti Next.js) untuk script terminal, mis. DATABASE_URL.
for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(f); } catch {}
}
