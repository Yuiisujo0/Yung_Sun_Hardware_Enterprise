// supabase.js
// Create a single Supabase client and attach it to window.supabaseClient.
// Include this file BEFORE any other scripts that use the Supabase client.

window.SUPABASE_URL = window.SUPABASE_URL || 'https://clhzzjugjttqidiuolrj.supabase.co';
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'sb_publishable_X8iVVZsZGbS9h_EKCds1wg_02UyKnpS';

// If a client already exists, reuse it (prevents multiple GoTrueClient instances warning)
if (!window.supabaseClient) {
  if (typeof supabase === 'undefined') {
    console.error('Supabase library not found. Please include https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 before supabase.js');
  } else {
    window.supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    console.log('Supabase client initialized (singleton).');
  }
} else {
  console.log('Supabase client already present — reusing existing instance.');
}