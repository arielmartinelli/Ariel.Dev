import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const isConfigured = supabaseUrl && supabaseAnonKey && !supabaseUrl.includes("tu-proyecto-id");

let supabaseInstance;

if (isConfigured) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  } catch (err) {
    console.error("Error inicializando Supabase:", err);
    supabaseInstance = createMockClient();
  }
} else {
  console.warn(
    "⚠️ Ariel.Dev: Las credenciales de Supabase no están configuradas en el archivo .env. La web funcionará en modo offline local (LocalStorage)."
  );
  supabaseInstance = createMockClient();
}

export const supabase = supabaseInstance;

// Genera un cliente de Supabase falso que imita las firmas para evitar errores en consola y activar el fallback
function createMockClient() {
  return {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => Promise.resolve({ data: [], error: null })
      }),
      insert: () => Promise.resolve({ data: [], error: null }),
      update: () => ({
        eq: () => ({
          select: () => Promise.resolve({ data: [], error: null })
        })
      }),
      delete: () => ({
        eq: () => Promise.resolve({ error: null })
      })
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      signInWithPassword: () => Promise.reject(new Error("Supabase no está configurado.")),
      onAuthStateChange: () => ({ data: { subscription: null } })
    }
  };
}
