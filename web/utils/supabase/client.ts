import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * Supabase Realtime + RLS (configure in Supabase Dashboard)
 * ---------------------------------------------------------
 * 1. Enable Realtime: ALTER PUBLICATION supabase_realtime ADD TABLE predictions;
 * 2. Enable RLS + anon SELECT on `predictions` and `games` (see ingestor/internal/database/schema.sql).
 * 3. Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Browser Supabase client — singleton in the browser to reuse one Realtime
 * WebSocket across hook mount/unmount cycles.
 */
export function createClient() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  if (typeof window === "undefined") {
    return createBrowserClient<Database>(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }

  return browserClient;
}
