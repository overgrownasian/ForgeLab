import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase-database";

export type BrowserSupabaseConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

let browserClient: ReturnType<typeof createClient<Database>> | null = null;
let browserClientKey: string | null = null;

export function createBrowserSupabaseClient(config: BrowserSupabaseConfig) {
  const { supabaseUrl, supabaseAnonKey } = config;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const cacheKey = `${supabaseUrl}::${supabaseAnonKey}`;

  if (!browserClient || browserClientKey !== cacheKey) {
    browserClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    browserClientKey = cacheKey;
  }

  return browserClient;
}
