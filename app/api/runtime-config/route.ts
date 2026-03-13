import { NextResponse } from "next/server";
import { getRuntimeSupabaseAnonKey, getRuntimeSupabaseUrl } from "@/lib/runtime-env";

export async function GET() {
  const supabaseUrl = getRuntimeSupabaseUrl();
  const supabaseAnonKey = getRuntimeSupabaseAnonKey();
  const openAiModel = process.env.OPENAI_MODEL;

  console.log("[runtime-config]", {
    configured: Boolean(supabaseUrl && supabaseAnonKey),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseAnonKey: Boolean(supabaseAnonKey),
    openAiModel: openAiModel ?? null
  });

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      {
        configured: false
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    configured: true,
    supabaseUrl,
    supabaseAnonKey
  });
}
