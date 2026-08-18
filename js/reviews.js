import { supabase } from "./supabase.js";

const LOCAL_STORAGE_KEY = "ariel_dev_reviews_v1";

const INITIAL_REVIEWS = [
  {
    id: "rev-1",
    client_name: "Mariano López",
    project_name: "López Odontología",
    company_url: "lopez-odontologia.com",
    rating: 5,
    comment: "Excelente trabajo de Ariel. La página quedó super rápida, moderna y mis pacientes ahora agendan turnos directamente desde el celular.",
    is_published: true,
    created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
  },
  {
    id: "rev-2",
    client_name: "Camila Fernández",
    project_name: "Aura Boutique Store",
    company_url: "auraboutique.com.ar",
    rating: 5,
    comment: "El seguimiento en vivo fue lo mejor. Sabía exactamente qué paso venía y el diseño superó mis expectativas. 100% recomendable.",
    is_published: true,
    created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
  {
    id: "rev-3",
    client_name: "Gonzalo Peralta",
    project_name: "TaskFlow SaaS",
    company_url: "taskflow-app.io",
    rating: 5,
    comment: "Atención personalizada impecable, desarrollo a medida rápido y entrega con dominio configurado sin vueltas.",
    is_published: true,
    created_at: new Date(Date.now() - 86400000 * 45).toISOString(),
  }
];

function leerLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(INITIAL_REVIEWS));
      return INITIAL_REVIEWS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_REVIEWS;
  }
}

function guardarLocal(lista) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(lista));
  } catch {
    // Silencioso
  }
}

export async function guardarResena({ client_name, project_name, company_url, rating, comment }) {
  const nuevaResena = {
    id: `rev-${Date.now()}`,
    client_name: (client_name || "Cliente").trim(),
    project_name: (project_name || "").trim(),
    company_url: (company_url || "").trim(),
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: (comment || "").trim(),
    is_published: true,
    created_at: new Date().toISOString(),
  };

  // 1. Guardar localmente
  const listaLocal = leerLocal();
  listaLocal.unshift(nuevaResena);
  guardarLocal(listaLocal);

  // 2. Intentar guardar en Supabase tabla `reviews`
  let guardadoEnTabla = false;
  try {
    const { error } = await supabase.from("reviews").insert([
      {
        client_name: nuevaResena.client_name,
        project_name: nuevaResena.project_name,
        company_url: nuevaResena.company_url,
        rating: nuevaResena.rating,
        comment: nuevaResena.comment,
        is_published: true,
      }
    ]);
    if (!error) guardadoEnTabla = true;
  } catch (e) {
    console.warn("Tabla reviews no disponible en Supabase:", e?.message);
  }

  // 3. Fallback inteligente: si tabla `reviews` no existe, guardar en admin_notes del cliente en Supabase
  if (!guardadoEnTabla) {
    try {
      const { data: clientes } = await supabase.from("clients").select("id, admin_notes").limit(1);
      if (clientes && clientes.length > 0) {
        const target = clientes[0];
        const resenaTag = `[RESEÑA_JSON:${JSON.stringify(nuevaResena)}]`;
        const nuevasNotas = ((target.admin_notes || "") + " " + resenaTag).trim();
        await supabase.from("clients").update({ admin_notes: nuevasNotas }).eq("id", target.id);
      }
    } catch (e) {
      console.warn("Fallback clients en Supabase:", e?.message);
    }
  }

  return { ok: true, resena: nuevaResena };
}

export async function obtenerResenasAdmin() {
  // 1. Probar tabla nativa `reviews`
  try {
    const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (e) {
    console.warn("Tabla reviews no accesible:", e?.message);
  }

  // 2. Probar rescate desde `clients.admin_notes` en Supabase
  try {
    const { data: clientes, error: errC } = await supabase.from("clients").select("admin_notes");
    if (!errC && clientes) {
      const extraidas = [];
      clientes.forEach((c) => {
        const matches = (c.admin_notes || "").match(/\[RESEÑA_JSON:(.*?)\]/g);
        if (matches) {
          matches.forEach((m) => {
            try {
              const jsonStr = m.replace(/^\[RESEÑA_JSON:/, "").replace(/\]$/, "");
              const rObj = JSON.parse(jsonStr);
              if (rObj && rObj.id && !extraidas.some(item => item.id === rObj.id)) {
                extraidas.push(rObj);
              }
            } catch {}
          });
        }
      });

      if (extraidas.length > 0) {
        const combinadas = [...extraidas];
        const local = leerLocal();
        local.forEach((l) => {
          if (!combinadas.some(item => item.id === l.id)) {
            combinadas.push(l);
          }
        });
        guardarLocal(combinadas);
        return combinadas;
      }
    }
  } catch (e) {
    console.warn("Fallback lectura clientes en Supabase:", e?.message);
  }

  return leerLocal();
}

export async function obtenerResenasPublicas() {
  const todas = await obtenerResenasAdmin();
  return todas.filter(r => r.is_published);
}

export async function togglePublicarResena(id, publicar) {
  const lista = leerLocal();
  const res = lista.find(r => r.id === id);
  if (res) {
    res.is_published = publicar;
    guardarLocal(lista);
  }

  try {
    await supabase.from("reviews").update({ is_published: publicar }).eq("id", id);
  } catch {}
  return { ok: true };
}

export async function eliminarResena(id) {
  const lista = leerLocal().filter(r => r.id !== id);
  guardarLocal(lista);

  try {
    await supabase.from("reviews").delete().eq("id", id);
  } catch {}
  return { ok: true };
}

export async function actualizarUrlResena(id, company_url) {
  const urlLimpia = (company_url || "").trim();
  const lista = leerLocal();
  const res = lista.find(r => r.id === id);
  if (res) {
    res.company_url = urlLimpia;
    guardarLocal(lista);
  }

  try {
    await supabase.from("reviews").update({ company_url: urlLimpia }).eq("id", id);
  } catch {}

  // Fallback en clients.admin_notes si aplica
  try {
    const { data: clientes } = await supabase.from("clients").select("id, admin_notes");
    if (clientes) {
      for (const c of clientes) {
        if (c.admin_notes && c.admin_notes.includes(id)) {
          const matches = c.admin_notes.match(/\[RESEÑA_JSON:(.*?)\]/g);
          if (matches) {
            let notas = c.admin_notes;
            matches.forEach((m) => {
              try {
                const jsonStr = m.replace(/^\[RESEÑA_JSON:/, "").replace(/\]$/, "");
                const rObj = JSON.parse(jsonStr);
                if (rObj.id === id) {
                  rObj.company_url = urlLimpia;
                  notas = notas.replace(m, `[RESEÑA_JSON:${JSON.stringify(rObj)}]`);
                }
              } catch {}
            });
            await supabase.from("clients").update({ admin_notes: notas }).eq("id", c.id);
          }
        }
      }
    }
  } catch {}

  return { ok: true };
}
