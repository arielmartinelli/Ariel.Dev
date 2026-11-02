/**
 * GET /api/marco-permite?u=<url del demo>
 *
 * Responde si ese sitio se deja mostrar adentro de un marco (<iframe>).
 *
 * POR QUE ESTO NO SE PUEDE HACER EN EL NAVEGADOR
 * ---------------------------------------------
 * Cuando una página se niega a ser mostrada en un marco, el navegador la
 * bloquea y NO avisa. Lo medí con los cuatro casos posibles y desde el
 * JavaScript de la página se ven idénticos:
 *
 *     sitio                     evento   location.href   contentDocument
 *     bloqueado (deny)          load     SecurityError   null
 *     bloqueado (sameorigin)    load     SecurityError   null
 *     permitido                 load     SecurityError   null
 *     que ni siquiera existe    load     SecurityError   null
 *
 * O sea: el evento `load` se dispara igual, y todo lo demás tira el mismo
 * error de seguridad porque es otro dominio. No hay forma de distinguir
 * "cargó bien" de "lo bloquearon" desde adentro. Por eso la pregunta se
 * hace acá, donde sí se pueden leer las cabeceras.
 *
 * QUE MIRA
 * --------
 *   X-Frame-Options: DENY | SAMEORIGIN   -> no se deja
 *   Content-Security-Policy: frame-ancestors ...  -> depende de la lista
 *
 * Ante la duda (el sitio no responde, tarda, da error) contesta que NO se
 * deja: es mejor mostrar la captura guardada que un rectángulo en blanco.
 *
 * LA RESPUESTA SE CACHEA UN DIA
 * -----------------------------
 * Son cabeceras que casi nunca cambian. Sin cache, cada visitante que entra
 * al portfolio dispararía 19 pedidos desde el servidor. Con s-maxage, el
 * CDN de Vercel contesta por nosotros y la función corre una vez por día y
 * por sitio. `stale-while-revalidate` evita que el primero del día pague la
 * espera.
 */

const TIEMPO_LIMITE_MS = 6000;

/** De dónde aceptamos que nos pidan comprobar. */
function urlUsable(crudo) {
  let u;
  try {
    u = new URL(crudo);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  /* Nada de direcciones internas. Sin esto, cualquiera podría pedirle a
     nuestro servidor que golpee la red privada del hosting y contarnos qué
     encontró, usando esta función como puente (SSRF). */
  const h = u.hostname.toLowerCase();
  const privada =
    h === "localhost" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127|10)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (privada) return null;

  return u;
}

/** ¿La política de este sitio nos deja mostrarlo? */
function seDejaMostrar(cabeceras) {
  const xfo = String(cabeceras.get("x-frame-options") || "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;

  const csp = String(cabeceras.get("content-security-policy") || "").toLowerCase();
  const m = csp.match(/frame-ancestors([^;]*)/);
  if (m) {
    const lista = m[1].trim();
    // 'none' no deja a nadie; 'self' solo al propio sitio.
    if (!lista || lista.includes("'none'")) return false;
    const soloPropio = lista.split(/\s+/).filter(Boolean).every((x) => x === "'self'");
    if (soloPropio) return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    return res.end();
  }

  const pedido = new URL(req.url, "http://localhost");
  const destino = urlUsable(pedido.searchParams.get("u") || "");

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");

  if (!destino) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ vivo: false, motivo: "url-no-usable" }));
  }

  const corte = AbortController ? new AbortController() : null;
  const reloj = corte ? setTimeout(() => corte.abort(), TIEMPO_LIMITE_MS) : null;

  try {
    /* HEAD primero: alcanza para leer las cabeceras y no baja el cuerpo.
       Algunos servidores no lo soportan y contestan 405; ahí se reintenta
       con GET. `redirect: follow` importa: varios de estos demos redirigen
       a su dominio propio y la cabecera que vale es la del destino. */
    let r = await fetch(destino.href, {
      method: "HEAD",
      redirect: "follow",
      signal: corte?.signal,
      headers: { "User-Agent": "ArielDev-PreviewCheck/1.0" },
    });
    if (r.status === 405 || r.status === 501) {
      r = await fetch(destino.href, {
        method: "GET",
        redirect: "follow",
        signal: corte?.signal,
        headers: { "User-Agent": "ArielDev-PreviewCheck/1.0" },
      });
    }

    if (!r.ok) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ vivo: false, motivo: `http-${r.status}` }));
    }

    const vivo = seDejaMostrar(r.headers);
    res.statusCode = 200;
    return res.end(JSON.stringify({ vivo, motivo: vivo ? "ok" : "cabecera-lo-prohibe" }));
  } catch (e) {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      vivo: false,
      motivo: e?.name === "AbortError" ? "tardo-demasiado" : "no-respondio",
    }));
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}
