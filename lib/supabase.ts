import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserSupabase: SupabaseClient<any> | null | undefined;

export function createBrowserSupabase() {
  if (typeof window === "undefined") return null;
  if (browserSupabase !== undefined) return browserSupabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    browserSupabase = null;
    return browserSupabase;
  }

  browserSupabase = createClient(url, key);
  return browserSupabase;
}
