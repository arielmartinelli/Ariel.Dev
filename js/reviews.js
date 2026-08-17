import { supabase } from "./supabase.js";

const LOCAL_STORAGE_KEY = "ariel_dev_reviews_v1";

// Reseñas iniciales de demostración para el portfolio
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
    is_published: true, // Por defecto se publica inmediatamente
    created_at: new Date().toISOString(),
  };

  // 1. Guardar en localStorage
  const listaLocal = leerLocal();
  listaLocal.unshift(nuevaResena);
  guardarLocal(listaLocal);

  // 2. Intentar guardar en Supabase si está disponible la tabla
  try {
    await supabase.from("reviews").insert([
      {
        client_name: nuevaResena.client_name,
        project_name: nuevaResena.project_name,
        company_url: nuevaResena.company_url,
        rating: nuevaResena.rating,
        comment: nuevaResena.comment,
        is_published: true,
      }
    ]);
  } catch {
    // Fallback local activo
  }

  return { ok: true, resena: nuevaResena };
}

export async function obtenerResenasAdmin() {
  try {
    const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    if (!error && data && data.length > 0) {
      return data;
    }
  } catch {
    // Fallback local
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
  } catch {
    // Fallback local
  }
  return { ok: true };
}

export async function eliminarResena(id) {
  const lista = leerLocal().filter(r => r.id !== id);
  guardarLocal(lista);

  try {
    await supabase.from("reviews").delete().eq("id", id);
  } catch {
    // Fallback local
  }
  return { ok: true };
}
