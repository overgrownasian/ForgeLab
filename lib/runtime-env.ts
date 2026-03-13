export function getRuntimeSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
}

export function getRuntimeSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY ?? process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
}
