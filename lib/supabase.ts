import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseAnonKey, getRuntimeSupabaseUrl } from "@/lib/runtime-env";
import type { Database } from "@/lib/supabase-database";

export function getSupabaseClient() {
  const supabaseUrl = getRuntimeSupabaseUrl();
  const supabaseAnonKey = getRuntimeSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
