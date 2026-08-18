/**
 * ui-dialogs.js — Capa unica sobre SweetAlert2.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 * ---------------------------
 * El bug reportado ("el cartel de confirmacion queda detras del panel") tenia
 * dos causas y las dos se arreglan aca y en styles.css:
 *
 *   1. Z-INDEX. SweetAlert2 escribe z-index 1060 en el atributo style de su
 *      contenedor. El panel admin es 1200. Resultado: el dialogo se abria
 *      literalmente por debajo del panel, invisible pero activo, dejando la
 *      interfaz trabada hasta cerrar el panel. Se corrige en styles.css con
 *      `.swal2-container { z-index: var(--z-dialog) !important; }` y ademas
 *      aca en runtime (`didOpen`), porque si alguna version futura de la
 *      libreria vuelve a pisar el valor inline, esto lo gana igual.
 *
 *   2. heightAuto. Por defecto SweetAlert2 toca la altura del <body> al
 *      abrirse. Con un modal abierto eso produce un salto de layout y, en
 *      iOS, que el panel se desplace solo. Se desactiva.
 *
 * Centralizar tambien evita el otro problema que tenia el codigo: 30 llamadas
 * sueltas a Swal.fire, cada una con su propio estilo de botones y sin foco
 * accesible. Ahora hay un solo lugar donde cambiar el comportamiento.
 */

/** Devuelve el Swal global solo si la libreria termino de cargar. */
function swal() {
  return typeof window !== "undefined" ? window.Swal : undefined;
}

const BASE = {
  heightAuto: false,
  scrollbarPadding: false,
  buttonsStyling: true,
  confirmButtonColor: "#6366f1",
  cancelButtonColor: "#64748b",
  focusConfirm: false,
  returnFocus: true,
};

/**
 * Parchea Swal una sola vez para que TODA llamada existente
 * (Swal.fire(...) suelto en app.js) herede la capa y el tema correctos,
 * sin tener que reescribir las 30 invocaciones.
 */
export function configurarDialogos() {
  const S = swal();
  if (!S || S.__arielConfigurado) return;

  const mezclado = S.mixin({
    ...BASE,
    didOpen: (popup) => {
      // Cinturon y tirantes: el CSS ya lo cubre, pero si la libreria vuelve a
      // escribir el z-index inline, este ajuste corre despues y gana.
      const contenedor = popup?.parentElement;
      if (contenedor) contenedor.style.zIndex = "2400";
    },
  });

  mezclado.__arielConfigurado = true;
  window.Swal = mezclado;
}

/**
 * Confirmacion destructiva o de compromiso. Devuelve true/false.
 * Nunca lanza: si SweetAlert2 no cargo, cae al confirm() nativo en vez de
 * dejar al usuario sin poder confirmar nada.
 */
export async function confirmar({
  titulo,
  texto = "",
  html = "",
  confirmar: textoConfirmar = "Sí, continuar",
  cancelar = "Cancelar",
  icono = "warning",
  peligroso = false,
}) {
  const S = swal();
  if (!S) return window.confirm(`${titulo}\n\n${texto}`);

  const { isConfirmed } = await S.fire({
    title: titulo,
    text: html ? undefined : texto,
    html: html || undefined,
    icon: icono,
    showCancelButton: true,
    confirmButtonText: textoConfirmar,
    cancelButtonText: cancelar,
    confirmButtonColor: peligroso ? "#ef4444" : "#6366f1",
    reverseButtons: true,
    focusCancel: peligroso,
  });

  return Boolean(isConfirmed);
}

/** Aviso simple (exito, error, info). */
export function avisar(titulo, texto = "", icono = "success") {
  const S = swal();
  if (!S) {
    window.alert(`${titulo}\n\n${texto}`);
    return Promise.resolve();
  }
  return S.fire({ title: titulo, text: texto, icon: icono });
}

/** Indicador de carga bloqueante para operaciones largas. */
export function cargando(titulo = "Procesando...") {
  const S = swal();
  if (!S) return;
  S.fire({
    title: titulo,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => S.showLoading(),
  });
}

export function cerrarCargando() {
  const S = swal();
  if (S) S.close();
}

/** Prompt simple para ingresar o editar un texto. */
export async function pedirTexto({
  titulo,
  texto = "",
  placeholder = "",
  valorInicial = "",
  confirmar: textoConfirmar = "Guardar",
  cancelar = "Cancelar",
}) {
  const S = swal();
  if (!S) {
    const res = window.prompt(`${titulo}\n\n${texto}`, valorInicial);
    return res;
  }

  const { isConfirmed, value } = await S.fire({
    title: titulo,
    text: texto,
    input: "text",
    inputValue: valorInicial,
    inputPlaceholder: placeholder,
    showCancelButton: true,
    confirmButtonText: textoConfirmar,
    cancelButtonText: cancelar,
    reverseButtons: true,
  });

  return isConfirmed ? (value || "").trim() : null;
}
