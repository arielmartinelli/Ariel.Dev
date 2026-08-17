import { supabase } from "./supabase.js";

/**
 * clients.js — Acceso a datos del sector cliente.
 *
 * Dos caminos bien separados, a proposito:
 *
 *   PORTAL (portal*)  — lo usa el cliente con su token. NUNCA toca las tablas
 *                       directamente: llama funciones RPC del servidor que
 *                       validan el token y devuelven solo su propia fila.
 *                       Ver supabase/portal-clientes.sql.
 *
 *   PANEL  (admin*)   — lo uso yo, autenticado. Va contra las tablas, y las
 *                       policies RLS exigen que auth.uid() sea mi cuenta.
 *
 * Si algun dia el portal empieza a hacer .from("clients"), es un bug de
 * seguridad: significaria que la lista de clientes quedo expuesta a la clave
 * anon publica.
 */

/* ==========================================================================
   Estados y etiquetas
   ========================================================================== */
export const ESTADOS = {
  demo_pendiente: { label: "1. Armando la demo", color: "#64748b" },
  demo_lista: { label: "1. Demo & Desarrollo (50% Adelanto)", color: "#06b6d4" },
  en_produccion: { label: "1. En producción (50% Adelanto)", color: "#6366f1" },
  desarrollo_listo: { label: "2. Elección de Dominio", color: "#8b5cf6" },
  dominio_listo: { label: "3. Pago Final (50% Restante)", color: "#f59e0b" },
  finalizado: { label: "4. Publicación Lista 🚀", color: "#22c55e" },
  rechazado: { label: "No continúa", color: "#ef4444" },
};

export const ETIQUETA_PAGO = {
  anticipo: "Anticipo (50%)",
  saldo: "Saldo final (50%)",
  dominio: "Dominio propio",
};

/* ==========================================================================
   PORTAL DEL CLIENTE (token, sin sesión)
   ========================================================================== */

/**
 * Mensaje de error para el cliente.
 *
 * El cliente no tiene por qué leer jerga de Postgres, pero un "no se pudo"
 * a secas tampoco sirve: no dice si tiene que reintentar, esperar o avisarte.
 * Cuando el problema es de instalación (una función que falta, un ON CONFLICT
 * roto) el detalle técnico SÍ se muestra — porque en ese caso el que necesita
 * el dato sos vos, y el cliente te lo va a reenviar por WhatsApp.
 */
function mensajePortal(error) {
  const msg = String(error?.message || "");

  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return "Parece que se cortó la conexión. Probá de nuevo en un momento.";
  }
  if (/function .* does not exist|schema cache|PGRST202/i.test(msg)) {
    return "El sistema está en mantenimiento. Avisale a Ariel por WhatsApp: falta actualizar la base.";
  }
  if (/ON CONFLICT|constraint|violates/i.test(msg)) {
    return `Hubo un problema técnico. Mandale esto a Ariel por WhatsApp: «${msg.slice(0, 160)}»`;
  }
  return msg
    ? `No se pudo completar. Detalle: ${msg.slice(0, 160)}`
    : "No se pudo completar la operación. Probá de nuevo.";
}

/**
 * Trae todo el estado del proyecto asociado al token.
 * Devuelve null si el token no existe o el link fue revocado — a proposito el
 * servidor responde igual en los dos casos, para no confirmarle a nadie que
 * un token "existe pero esta desactivado".
 */
export async function portalObtener(token) {
  const { data, error } = await supabase.rpc("portal_obtener", { p_token: token });
  if (error) {
    console.error("portal_obtener:", error.message);
    throw new Error("No pudimos cargar tu proyecto. Probá de nuevo en un momento.");
  }
  return data || null;
}

/** El cliente acepta (con su lista de cambios) o rechaza seguir a producción. */
export async function portalDecidir(token, decision, cambios = []) {
  const { data, error } = await supabase.rpc("portal_decidir", {
    p_token: token,
    p_decision: decision,
    p_cambios: cambios,
  });
  if (error) {
    console.error("portal_decidir:", error.message);
    return { ok: false, error: mensajePortal(error) };
  }
  return data;
}

/** Elección de dominio: el de Vercel que ya viene, o uno propio (+USD). */
export async function portalElegirDominio(token, opcion, dominio = null) {
  const { data, error } = await supabase.rpc("portal_elegir_dominio", {
    p_token: token,
    p_opcion: opcion,
    p_dominio: dominio,
  });
  if (error) {
    console.error("portal_elegir_dominio:", error.message);
    return { ok: false, error: mensajePortal(error) };
  }
  return data;
}

/** Pedido de cambio adicional durante la producción. */
export async function portalPedirCambio(token, texto) {
  const { data, error } = await supabase.rpc("portal_pedir_cambio", {
    p_token: token,
    p_texto: texto,
  });
  if (error) {
    console.error("portal_pedir_cambio:", error.message);
    return { ok: false, error: mensajePortal(error) };
  }
  return data;
}

/** El cliente sube la foto del comprobante de una transferencia. */
export async function portalSubirComprobante(token, kind, imagen, nota = null) {
  const { data, error } = await supabase.rpc("portal_subir_comprobante", {
    p_token: token,
    p_kind: kind,
    p_imagen: imagen,
    p_nota: nota,
  });
  if (error) {
    console.error("portal_subir_comprobante:", error.message);
    return { ok: false, error: mensajePortal(error) };
  }
  return data;
}

/* ==========================================================================
   PANEL PROPIETARIO (requiere sesión de Ariel)
   ========================================================================== */

export async function adminListarClientes() {
  const { data, error } = await supabase
    .from("v_clientes_panel")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("adminListarClientes:", error.message);
    // Se conserva el error original para que quien lo reciba pueda saber si
    // falta el esquema y mostrar las instrucciones en vez de un genérico.
    const e = new Error(traducirError(error));
    e.faltaEsquema = faltaEsquema(error);
    throw e;
  }
  return data || [];
}

export async function adminCrearCliente(cliente) {
  const { data, error } = await supabase
    .from("clients")
    .insert([
      {
        client_name: cliente.clientName,
        project_name: cliente.projectName,
        project_brief: cliente.brief || null,
        demo_url: cliente.demoUrl || null,
        price_usd: Number(cliente.priceUsd) || 0,
        whatsapp: cliente.whatsapp || null,
        // Si ya cargaste el link de la demo, el proyecto nace "demo lista":
        // es exactamente el momento en que le mandás el link al cliente.
        status: cliente.demoUrl ? "demo_lista" : "demo_pendiente",
      },
    ])
    .select("id, access_token, client_name, project_name");

  if (error) {
    console.error("adminCrearCliente:", error.message);
    return { ok: false, error: traducirError(error) };
  }
  return { ok: true, cliente: data?.[0] };
}

export async function adminActualizarCliente(id, campos) {
  const { data, error } = await supabase
    .from("clients")
    .update(campos)
    .eq("id", id)
    .select("id");

  if (error) {
    console.error("adminActualizarCliente:", error.message);
    return { ok: false, error: traducirError(error) };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "No se actualizó ninguna fila (¿el cliente fue eliminado?)." };
  }
  return { ok: true };
}

export async function adminEliminarCliente(id) {
  // ON DELETE CASCADE se lleva tareas y pagos: por eso en el panel esto pide
  // confirmación explícita antes de llamarse.
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    console.error("adminEliminarCliente:", error.message);
    return { ok: false, error: traducirError(error) };
  }
  return { ok: true };
}

/** Revoca el link sin perder el historial del proyecto. */
export async function adminRevocarLink(id, activo) {
  return adminActualizarCliente(id, { is_active: activo });
}

export async function adminListarTareas(clientId) {
  const { data, error } = await supabase
    .from("client_tasks")
    .select("*")
    .eq("client_id", clientId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("adminListarTareas:", error.message);
    return [];
  }
  return data || [];
}

export async function adminAgregarTarea(clientId, title, position = 999) {
  const { error } = await supabase
    .from("client_tasks")
    .insert([{ client_id: clientId, title, source: "ariel", position }]);
  if (error) return { ok: false, error: traducirError(error) };
  return { ok: true };
}

export async function adminMarcarTarea(taskId, done) {
  const { error } = await supabase
    .from("client_tasks")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (error) return { ok: false, error: traducirError(error) };
  return { ok: true };
}

export async function adminEliminarTarea(taskId) {
  const { error } = await supabase.from("client_tasks").delete().eq("id", taskId);
  if (error) return { ok: false, error: traducirError(error) };
  return { ok: true };
}

export async function adminListarPagos(clientId) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("adminListarPagos:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Marca un pago a mano (transferencia, efectivo).
 * Los pagos por Mercado Pago NO se tocan desde acá: los confirma el webhook
 * con el dato que manda Mercado Pago. Marcar un cobro a mano porque el
 * cliente dijo que pagó es exactamente como se cuelan los pagos falsos.
 */
export async function adminMarcarPago(paymentId, { status, method = "transferencia" }) {
  const { error } = await supabase
    .from("payments")
    .update({
      status,
      method,
      paid_at: status === "pagado" ? new Date().toISOString() : null,
    })
    .eq("id", paymentId);
  if (error) return { ok: false, error: traducirError(error) };
  return { ok: true };
}

/**
 * Trae la imagen del comprobante de UN pago.
 * Se pide aparte y solo al abrirlo: son cientos de KB por fila, y traerlas
 * todas en la consulta general de cobros para mostrar una sola es tirar
 * ancho de banda.
 */
export async function adminObtenerComprobante(paymentId) {
  const { data, error } = await supabase
    .from("payments")
    .select("receipt_image, receipt_note, receipt_uploaded_at")
    .eq("id", paymentId)
    .maybeSingle();

  if (error) {
    console.error("adminObtenerComprobante:", error.message);
    return null;
  }
  return data
    ? { imagen: data.receipt_image, nota: data.receipt_note, fecha: data.receipt_uploaded_at }
    : null;
}

/**
 * Cobro manual: cualquier importe, fuera del esquema anticipo/saldo/dominio.
 * Usa kind='otro', que es el unico que admite varios por cliente.
 */
export async function adminCrearCobroManual(clientId, { concepto, montoUsd, yaCobrado }) {
  const { error } = await supabase.from("payments").insert([
    {
      client_id: clientId,
      kind: "otro",
      amount_usd: Number(montoUsd),
      status: yaCobrado ? "pagado" : "pendiente",
      method: yaCobrado ? "transferencia" : null,
      paid_at: yaCobrado ? new Date().toISOString() : null,
      receipt_note: concepto || null,
    },
  ]);

  if (error) return { ok: false, error: traducirError(error) };
  return { ok: true };
}

/** Crea el pago del saldo final (50%) cuando el proyecto llega al 100%. */
export async function adminCrearSaldoFinal(clientId, priceUsd) {
  const { error } = await supabase.from("payments").insert([
    { client_id: clientId, kind: "saldo", amount_usd: Number((priceUsd * 0.5).toFixed(2)) },
  ]);
  if (error && !/duplicate|unique/i.test(error.message)) {
    return { ok: false, error: traducirError(error) };
  }
  return { ok: true };
}

/* ==========================================================================
   Consultas transversales (para el Resumen y la sección Cobros)
   --------------------------------------------------------------------------
   Traen datos de TODOS los clientes de una sola vez, en lugar de recorrer
   cliente por cliente. Con 20 clientes eso serían 20 consultas: acá es una.
   ========================================================================== */

/**
 * Todas las tareas, con el proyecto y el cliente al que pertenecen.
 * Es la cola de trabajo: qué falta hacer, en qué proyecto, para quién.
 *
 * Se excluyen los proyectos rechazados: sus tareas ya no hay que hacerlas y
 * solo ensucian la lista.
 */
export async function adminTareasDeTodos() {
  const { data, error } = await supabase
    .from("client_tasks")
    .select("id, title, done, source, created_at, done_at, position, client_id, clients!inner(client_name, project_name, status)")
    .neq("clients.status", "rechazado")
    .order("position", { ascending: true });

  if (error) {
    console.error("adminTareasDeTodos:", error.message);
    const e = new Error(traducirError(error));
    e.faltaEsquema = faltaEsquema(error);
    throw e;
  }

  return (data || []).map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    source: t.source,
    doneAt: t.done_at,
    createdAt: t.created_at,
    clientId: t.client_id,
    clientName: t.clients?.client_name || "",
    projectName: t.clients?.project_name || "",
    projectStatus: t.clients?.status || "",
  }));
}

/** Todos los pagos, con el cliente al que pertenecen. */
export async function adminPagosDeTodos() {
  const { data, error } = await supabase
    .from("payments")
    .select("id, kind, amount_usd, amount_ars, status, method, paid_at, created_at, mp_payment_id, client_id, clients!inner(client_name, project_name)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("adminPagosDeTodos:", error.message);
    const e = new Error(traducirError(error));
    e.faltaEsquema = faltaEsquema(error);
    throw e;
  }

  return (data || []).map((p) => ({
    id: p.id,
    kind: p.kind,
    amountUsd: Number(p.amount_usd) || 0,
    amountArs: p.amount_ars ? Number(p.amount_ars) : null,
    status: p.status,
    method: p.method,
    paidAt: p.paid_at,
    createdAt: p.created_at,
    mpPaymentId: p.mp_payment_id,
    clientId: p.client_id,
    clientName: p.clients?.client_name || "",
    projectName: p.clients?.project_name || "",
  }));
}

/* ==========================================================================
   Utilidades compartidas
   ========================================================================== */

/** Arma el link privado que se le pasa al cliente por WhatsApp. */
export function urlPortal(token, origen = window.location.origin) {
  return `${origen}/cliente/${encodeURIComponent(token)}`;
}

/**
 * ¿El error dice que las tablas del portal todavía no existen?
 *
 * Es el caso MÁS común al estrenar esto: el código está, pero el SQL de
 * supabase/portal-clientes.sql no se corrió. PostgREST lo reporta de dos
 * formas según la versión: el código 42P01 de Postgres ("relation does not
 * exist") o PGRST205 ("Could not find the table in the schema cache").
 */
export function faltaEsquema(error) {
  const msg = String(error?.message || "");
  const code = String(error?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|Could not find the table/i.test(msg)
  );
}

function traducirError(error) {
  const msg = String(error?.message || "");

  // Este mensaje va primero porque es el que más veces vas a ver, y decir
  // "no se pudo completar la operación" acá es peor que no decir nada:
  // esconde que falta un paso de instalación y manda a buscar el problema
  // donde no está.
  if (faltaEsquema(error)) {
    return "Las tablas del portal todavía no existen en Supabase. " +
           "Falta ejecutar supabase/portal-clientes.sql en el SQL Editor.";
  }

  if (/row-level security|permission|42501/i.test(msg)) {
    return "El servidor rechazó la operación por permisos. Revisá que las policies RLS " +
           "usen tu UID y que tu sesión siga activa.";
  }
  if (/JWT|not authenticated|401/i.test(msg)) {
    return "Tu sesión venció. Cerrá sesión y volvé a entrar.";
  }
  if (/duplicate key|unique/i.test(msg)) {
    return "Ya existe un registro con esos datos.";
  }
  if (/violates check constraint/i.test(msg)) {
    return "Algún dato no cumple el formato esperado (revisá los links y el precio).";
  }
  if (/violates foreign key/i.test(msg)) {
    return "El registro relacionado ya no existe. Actualizá la página.";
  }
  if (/Failed to fetch|network|NetworkError/i.test(msg)) {
    return "Sin conexión con el servidor.";
  }

  // Último recurso: se muestra el mensaje real en vez de uno genérico.
  // Es feo, pero es información; "no se pudo completar la operación" no lo es.
  return msg ? `Error del servidor: ${msg}` : "No se pudo completar la operación.";
}
