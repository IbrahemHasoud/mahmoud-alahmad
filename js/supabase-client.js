import { APP_CONFIG } from "./config.js";

let clientPromise = null;

export function isSupabaseConfigured() {
  return Boolean(
    APP_CONFIG.SUPABASE_URL &&
    APP_CONFIG.SUPABASE_ANON_KEY &&
    APP_CONFIG.SUPABASE_URL.startsWith("https://")
  );
}

export async function getSupabase() {
  if (!isSupabaseConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
      .then(({ createClient }) => createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }))
      .catch((error) => {
        clientPromise = null;
        throw new Error(`تعذر تحميل مكتبة Supabase: ${error.message}`);
      });
  }
  return clientPromise;
}
