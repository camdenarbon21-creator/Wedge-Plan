// Copy to config.js and fill in. config.js is gitignored.
// The anon key is safe to expose in a client app AS LONG AS Row Level Security
// is on. If you leave RLS off, anyone with this key can read and write your data.
// For a single-user app the simplest safe setup is RLS on with an auth'd policy.
window.WEDGE_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",

  // Leave sync off and the app runs fully local (IndexedDB). Turn it on once
  // Supabase is set up. Either way every write lands locally first.
  SYNC_ENABLED: false,
};
