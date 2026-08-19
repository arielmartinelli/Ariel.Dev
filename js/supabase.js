import { createClient } from "@supabase/supabase-js";

/**
 * supabase.js — Cliente único de Supabase.
 *
 * DÓNDE VIVE EL TOKEN DE SESIÓN
 * -----------------------------
 * La sesión (el JWT) se guarda en localStorage. Es el comportamiento por
 * defecto de supabase-js y, para una app sin backend propio, es la opción
 * razonable: la alternativa —cookie httpOnly— exige un servidor que maneje
 * la sesión, que es justamente lo que este proyecto no tiene.
 *
 * La consecuencia hay que decirla: si algún día entra un XSS en el panel, el
 * token es robable. Por eso el proyecto no depende de esconderlo:
 *   - todo lo que se inyecta en innerHTML pasa por escapeHtml() o safeUrl();
 *   - la CSP declara script-src 'self' (sin CDNs, sin 'unsafe-inline');
 *   - el token vence y se rota solo;
 *   - y sobre todo: la autorización real está en las policies RLS. Un token
 *     robado no habilita más de lo que ya habilita la cuenta.
 *
 * Ver AUDITORIA.md, sección 11.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

const isConfigured = supabaseUrl && supabaseAnonKey && !supabaseUrl.includes("tu-proyecto-id");

let supabaseInstance;

if (isConfigured) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Explícito, aunque coincida con el default: que la elección se lea
        // en el código y no haya que deducirla de la documentación.
        persistSession: true,
        autoRefreshToken: true,

        // El portal del cliente NUNCA usa sesiones: entra por token en la
        // URL. Si algún día Supabase agrega un flujo que deje una sesión al
        // pasar por una URL, no queremos que se active sola en esa página.
        detectSessionInUrl: false,

        storageKey: "arieldev-auth",
      },
    });
  } catch (err) {
    console.error("Error inicializando Supabase:", err);
    supabaseInstance = createMockClient();
  }
} else {
  console.warn(
    "⚠️ Ariel.Dev: faltan las credenciales de Supabase en el archivo .env. " +
    "La web funciona en modo offline (LocalStorage) y el panel no puede validar credenciales."
  );
  supabaseInstance = createMockClient();
}

export const supabase = supabaseInstance;

/**
 * Indica si hay credenciales reales de Supabase.
 * NO es un dato sensible: cualquiera lo deduce mirando si el sitio hace
 * peticiones a supabase.co.
 */
export const isSupabaseConfigured = Boolean(isConfigured);

/**
 * Cliente falso para cuando no hay credenciales.
 *
 * BUG CORREGIDO: la versión anterior solo imitaba `from().select()`,
 * `insert`, `update` y `delete`. El código nuevo usa además `rpc()`,
 * `maybeSingle()`, `neq()`, `limit()` y `order()` encadenado — así que sin
 * `.env` el portal del cliente moría con `supabase.rpc is not a function`
 * en vez de degradar con elegancia, que era todo el propósito de este objeto.
 *
 * Se implementa como un encadenador genérico: cualquier método devuelve algo
 * que también es encadenable Y que además es "thenable", así que se puede
 * await en cualquier punto de la cadena.
 */
function createMockClient() {
  const RESPUESTA_VACIA = { data: [], error: null };

  function cadena(resultado = RESPUESTA_VACIA) {
    const manejador = {
      get(_destino, prop) {
        // Permite `await consulta` en cualquier punto de la cadena.
        if (prop === "then") {
          return (resolver) => Promise.resolve(resultado).then(resolver);
        }
        if (prop === "catch" || prop === "finally") {
          return () => cadena(resultado);
        }
        // maybeSingle()/single() devuelven un objeto, no un array.
        if (prop === "maybeSingle" || prop === "single") {
          return () => cadena({ data: null, error: null });
        }
        // Cualquier otro método (select, eq, neq, order, limit, in, …)
        // sigue la cadena.
        return () => cadena(resultado);
      },
    };
    return new Proxy(function () {}, manejador);
  }

  return {
    from: () => cadena(),

    // Las funciones del portal devuelven un objeto de error explícito para
    // que la interfaz muestre un mensaje útil en vez de quedarse en blanco.
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { message: "Supabase no está configurado (falta el .env)." },
      }),

    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signInWithPassword: () =>
        Promise.resolve({
          data: null,
          error: { message: "Supabase no está configurado (falta el .env)." },
        }),
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  };
}
