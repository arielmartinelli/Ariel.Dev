import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// Alerta en la consola de desarrollo si no están configuradas las llaves reales
if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("tu-proyecto-id")) {
  console.warn(
    "⚠️ Ariel.Dev: Las credenciales de Supabase no están configuradas en el archivo .env. Por favor edita el archivo .env con tus claves reales."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
