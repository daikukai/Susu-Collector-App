import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://dovxngyajzvupbfqsocg.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvdnhuZ3lhanp2dXBiZnFzb2NnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMTA0MjUsImV4cCI6MjEwNDY4NjQyNX0.GyCjOttGOTqrMmMd58vVXEw_XZ1Jio3l9I9vHZuwVMg";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
