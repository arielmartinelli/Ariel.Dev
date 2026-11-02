/**
 * panel-demo.js — El panel de resultados del hero.
 *
 * Reemplaza la caja de código que había antes. La caja mostraba un objeto de
 * JavaScript: le hablaba a alguien que programa. El que entra a pedir una
 * página no programa — entiende "visitas" y "consultas".
 *
 * ---------------------------------------------------------------------------
 * POR QUE SON DOS GRAFICOS Y NO UNO CON DOS LINEAS
 * ---------------------------------------------------------------------------
 * Visitas y consultas no viven en la misma escala: 2.800 contra 46. En un
 * solo gráfico, la línea de consultas queda pegada al piso y no se lee.
 *
 * La salida fácil sería poner un segundo eje a la derecha con su propia
 * escala. No se hace: con dos ejes, dónde se cruzan las líneas lo decide
 * quien eligió las escalas, no los datos. Cualquier par de series se puede
 * hacer parecer que "van juntas" moviendo un eje. Es el error más común de
 * los gráficos de negocio.
 *
 * La forma honesta son dos paneles apilados, cada uno con SU escala y su
 * nombre al lado, compartiendo los mismos siete días abajo. Se comparan las
 * FORMAS, que es la pregunta real: ¿suben las dos?
 *
 * ---------------------------------------------------------------------------
 * LOS COLORES ESTAN VALIDADOS, NO ELEGIDOS A OJO
 * ---------------------------------------------------------------------------
 * Pasados por el validador de paletas, en los dos temas, contra el fondo real
 * de la tarjeta. Las seis comprobaciones (banda de luminosidad, piso de
 * saturación, separación bajo daltonismo, piso de visión normal, contraste)
 * dan PASS. Tema oscuro #6366f1 / #0891b2, tema claro #4f46e5 / #0284c7.
 *
 * Además cada panel lleva su nombre escrito al lado: si alguien no distingue
 * los dos colores, igual sabe cuál es cuál.
 *
 * ---------------------------------------------------------------------------
 * LOS NUMEROS SON DE MENTIRA Y LO DICE EN PANTALLA
 * ---------------------------------------------------------------------------
 * Son una muestra de cómo se vería, no resultados de un cliente. Por eso la
 * etiqueta "Vista demostrativa" está SIEMPRE visible y no al pasar el mouse.
 * Todo sale de DATOS, acá abajo: para cambiarlo se toca un solo lugar.
 */

/* ==========================================================================
   Los datos. Todo lo que se ve sale de acá.
   ========================================================================== */
const DATOS = {
  dias: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],

  indicadores: [
    { clave: "visitas",    rotulo: "Visitas",     valor: 2847, sufijo: "",  cambio: "+18%", icono: "ojo" },
    { clave: "consultas",  rotulo: "Consultas",   valor: 46,   sufijo: "",  cambio: "+12%", icono: "sobre" },
    { clave: "conversion", rotulo: "Conversión",  valor: 1.6,  sufijo: "%", cambio: null,   icono: "embudo" },
    { clave: "tiempo",     rotulo: "Carga",       valor: 0.9,  sufijo: "s", cambio: null,   icono: "rayo" },
  ],

  series: [
    { clave: "visitas",   rotulo: "Visitas",   datos: [312, 358, 341, 402, 455, 489, 490] },
    { clave: "consultas", rotulo: "Consultas", datos: [4, 5, 5, 7, 8, 8, 9] },
  ],

  actividad: [
    { texto: "Nueva consulta desde el formulario", hace: "hace 2 min",  tono: "bien" },
    { texto: "Visita desde una búsqueda en Google", hace: "hace 11 min", tono: "neutro" },
    { texto: "Pedido de presupuesto",               hace: "hace 1 h",    tono: "bien" },
  ],

  sellos: ["Se adapta al celular", "Preparada para Google", "Carga liviana"],
};

/* Dos tonos por serie, uno por tema. El de la luz no es el mismo apagado:
   sobre blanco hace falta bajar la luminosidad para que el trazo se vea. */
const TONOS = {
  oscuro: { visitas: "#6366f1", consultas: "#0891b2" },
  claro:  { visitas: "#4f46e5", consultas: "#0284c7" },
};

const TRAZOS = {
  ojo:    '<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  sobre:  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  embudo: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  rayo:   '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};

/* Medidas del dibujo. Son coordenadas internas del SVG, no píxeles: el SVG
   se estira al ancho que haya con preserveAspectRatio. */
const ANCHO = 300;
const ALTO_PANEL = 46;
const PAD_X = 3;

const quieto = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ==========================================================================
   Armado
   ========================================================================== */
export function montarPanelDemo(contenedor) {
  if (!contenedor) return;

  contenedor.innerHTML = `
    <div class="pd-top">
      <span class="pd-top-txt">
        <span class="pd-pulso" aria-hidden="true"></span>
        Resultados del sitio
      </span>
      <!-- Siempre visible, no al pasar el mouse: son números inventados y el
           visitante tiene que saberlo sin tener que averiguarlo. -->
      <span class="pd-demo">Vista demostrativa</span>
    </div>

    <div class="pd-kpis">
      ${DATOS.indicadores.map(tarjetaIndicador).join("")}
    </div>

    <div class="pd-graficos">
      ${DATOS.series.map((s, i) => panelSerie(s, i)).join("")}
      <div class="pd-dias" aria-hidden="true">
        ${DATOS.dias.map((d) => `<span>${d}</span>`).join("")}
      </div>
    </div>

    <div class="pd-pie">
      <ul class="pd-actividad">
        ${DATOS.actividad.map((a) => `
          <li class="pd-act-item">
            <span class="pd-act-punto pd-act-${a.tono}" aria-hidden="true"></span>
            <span class="pd-act-txt">${a.texto}</span>
            <span class="pd-act-hace">${a.hace}</span>
          </li>`).join("")}
      </ul>
      <div class="pd-sellos">
        ${DATOS.sellos.map((s) => `<span class="pd-sello">${s}</span>`).join("")}
      </div>
    </div>

    <!-- La misma información en texto, para quien no puede ver el dibujo.
         Un gráfico sin esto es un dato que existe solo para algunos. -->
    <table class="sr-only">
      <caption>Datos de ejemplo de los últimos siete días</caption>
      <tr><th scope="col">Día</th>${DATOS.series.map((s) => `<th scope="col">${s.rotulo}</th>`).join("")}</tr>
      ${DATOS.dias.map((d, i) => `
        <tr><th scope="row">${d}</th>${DATOS.series.map((s) => `<td>${s.datos[i]}</td>`).join("")}</tr>`).join("")}
    </table>`;

  conectarTooltip(contenedor);
  arrancarCuandoSeVea(contenedor);
}

function tarjetaIndicador(ind) {
  const trazo = TRAZOS[ind.icono] || "";
  const valor = ind.sufijo === "%" || ind.sufijo === "s"
    ? ind.valor.toFixed(1)
    : ind.valor.toLocaleString("es-AR");
  return `
    <div class="pd-kpi">
      <span class="pd-kpi-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round">${trazo}</svg>
      </span>
      <span class="pd-kpi-rotulo">${ind.rotulo}</span>
      <strong class="pd-kpi-valor"
              data-hasta="${ind.valor}"
              data-sufijo="${ind.sufijo}">${valor}${ind.sufijo}</strong>
      ${ind.cambio ? `<span class="pd-kpi-sube">${ind.cambio}</span>` : ""}
    </div>`;
}

/**
 * Un panel = una serie. Cada uno con SU escala: el máximo de arriba es el
 * máximo de ESA serie, y está escrito al costado para que no haya que
 * adivinarlo.
 */
function panelSerie(serie, i) {
  const max = Math.max(...serie.datos);
  const paso = (ANCHO - PAD_X * 2) / (serie.datos.length - 1);

  const puntos = serie.datos.map((v, k) => ({
    x: PAD_X + k * paso,
    /* 4 de margen arriba: sin eso el pico toca el borde y parece recortado. */
    y: ALTO_PANEL - 4 - (v / max) * (ALTO_PANEL - 10),
    v,
  }));

  const linea = suave(puntos);
  const area = `${linea} L ${puntos.at(-1).x} ${ALTO_PANEL} L ${puntos[0].x} ${ALTO_PANEL} Z`;

  return `
    <div class="pd-grafico" data-serie="${serie.clave}">
      <div class="pd-grafico-rotulo">
        <span class="pd-punto" aria-hidden="true"></span>
        ${serie.rotulo}
        <span class="pd-grafico-max">máx ${max.toLocaleString("es-AR")}</span>
      </div>
      <svg class="pd-svg" viewBox="0 0 ${ANCHO} ${ALTO_PANEL}" preserveAspectRatio="none"
           role="img" aria-label="${serie.rotulo} de los últimos siete días, datos de ejemplo">
        <defs>
          <linearGradient id="pd-relleno-${i}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="currentColor" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path class="pd-area" d="${area}" fill="url(#pd-relleno-${i})"/>
        <path class="pd-linea" d="${linea}" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              vector-effect="non-scaling-stroke"/>
        ${puntos.map((p, k) => `
          <circle class="pd-nodo" cx="${p.x}" cy="${p.y}" r="2.6"
                  data-i="${k}" data-v="${p.v}"/>`).join("")}
      </svg>
    </div>`;
}

/**
 * Curva suave por Catmull-Rom convertida a Bézier. Se usa una tensión baja
 * (1/6) a propósito: con más, la curva se pasa de los puntos y dibuja subidas
 * que los datos no tienen — queda lindo y miente.
 */
function suave(p) {
  if (p.length < 2) return "";
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i];
    const b = p[i];
    const c = p[i + 1];
    const e = p[i + 2] || c;
    d += ` C ${b.x + (c.x - a.x) / 6} ${b.y + (c.y - a.y) / 6},` +
         ` ${c.x - (e.x - b.x) / 6} ${c.y - (e.y - b.y) / 6},` +
         ` ${c.x} ${c.y}`;
  }
  return d;
}

/* ==========================================================================
   Que se vea cuando aparece, y una sola vez
   ========================================================================== */
function arrancarCuandoSeVea(cont) {
  if (quieto()) {
    cont.classList.add("pd-listo");
    return;
  }
  const ojo = new IntersectionObserver((entradas, obs) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      obs.disconnect();
      cont.classList.add("pd-listo");          // dispara el dibujo de las líneas
      for (const el of cont.querySelectorAll(".pd-kpi-valor")) contar(el);
    }
  }, { threshold: 0.25 });
  ojo.observe(cont);
}

/**
 * El contador. Usa requestAnimationFrame y no setInterval: el navegador lo
 * pausa solo cuando la pestaña está en segundo plano, así que nadie vuelve a
 * una pestaña vieja y encuentra el número a mitad de camino.
 */
function contar(el) {
  const hasta = Number(el.dataset.hasta);
  const sufijo = el.dataset.sufijo || "";
  const decimales = hasta % 1 !== 0 ? 1 : 0;
  const DURACION = 1100;
  const t0 = performance.now();

  const escribir = (v) => {
    el.textContent = (decimales
      ? v.toFixed(1)
      : Math.round(v).toLocaleString("es-AR")) + sufijo;
  };

  escribir(0);
  const paso = (t) => {
    const avance = Math.min(1, (t - t0) / DURACION);
    // Frena al final en vez de cortar de golpe.
    escribir(hasta * (1 - Math.pow(1 - avance, 3)));
    if (avance < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/* ==========================================================================
   El dato al pasar el mouse
   -------------------------------------------------------------------------
   Un gráfico en pantalla que no contesta "¿cuánto es este punto?" obliga a
   estimarlo contra un eje. El globito lo dice.

   Se escucha en el contenedor y no en cada punto: son catorce nodos que
   además se redibujan, y así alcanza un solo oyente.
   ========================================================================== */
function conectarTooltip(cont) {
  const globo = document.createElement("div");
  globo.className = "pd-globo";
  globo.hidden = true;
  cont.appendChild(globo);

  const mostrar = (nodo) => {
    const grafico = nodo.closest(".pd-grafico");
    const serie = DATOS.series.find((s) => s.clave === grafico?.dataset.serie);
    const i = Number(nodo.dataset.i);
    globo.textContent = `${DATOS.dias[i]} · ${Number(nodo.dataset.v).toLocaleString("es-AR")} ${serie ? serie.rotulo.toLowerCase() : ""}`;
    globo.hidden = false;

    const c = cont.getBoundingClientRect();
    const n = nodo.getBoundingClientRect();
    globo.style.left = `${n.left + n.width / 2 - c.left}px`;
    globo.style.top = `${n.top - c.top}px`;
    nodo.classList.add("activo");
  };

  const ocultar = () => {
    globo.hidden = true;
    cont.querySelectorAll(".pd-nodo.activo").forEach((n) => n.classList.remove("activo"));
  };

  cont.addEventListener("pointerover", (e) => {
    const nodo = e.target.closest?.(".pd-nodo");
    if (nodo) mostrar(nodo);
  });
  cont.addEventListener("pointerout", (e) => {
    if (e.target.closest?.(".pd-nodo")) ocultar();
  });
  cont.addEventListener("pointerleave", ocultar);
}

export { DATOS as DATOS_DEMO, TONOS as TONOS_DEMO };
