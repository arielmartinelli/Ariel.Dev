# Auditoría de la landing — octubre 2026

Todo lo que está acá está **medido en Chromium**, no leído del código ni
supuesto. Donde digo un número, salió de una medición; donde una sospecha mía
no se confirmó, lo digo igual.

**Puntaje: 14/20 — Bien, con dos cosas que arreglaría antes de seguir
invirtiendo en otra cosa.**

| # | Dimensión | Puntaje | Hallazgo principal |
|---|---|---|---|
| 1 | Accesibilidad | 2/4 | Un botón de acción con contraste 1.98:1 y objetivos táctiles de 20px |
| 2 | Rendimiento | 4/4 | LCP 1,48 s · CLS 0,014 · una sola tarea larga |
| 3 | Responsive | 2/4 | Scroll horizontal en 320px y 360px |
| 4 | Theming | 3/4 | Sistema de tokens sólido, con colores sueltos en secciones viejas |
| 5 | Integridad de implementación | 3/4 | Coherente; dos sistemas que se pisan en el portfolio |

---

## Lo primero: encontré tu bug del scroll

Hace varias conversaciones me dijiste:

> «al principio apenas carga la pagina en mis proyectos, el primer y segundo
> scroll de proyecto tiene como un bug»

Nunca lo habíamos mirado. **Existe, y es esto:**

Todos los bloques de la página entran con una animación: aparecen subiendo
30px. La clase es `.reveal-on-scroll`:

```css
.reveal-on-scroll { opacity: 0; transform: translateY(30px); }
.reveal-on-scroll.revealed { opacity: 1; transform: translateY(0); }
```

Pero el efecto de tarjetas apiladas escribe el `transform` **como estilo
inline**, y lo hace apenas carga la página, antes de que ninguna tarjeta se
haya revelado:

```js
innerCard.style.transform = `perspective(1200px) scale(${targetScale})`;
```

Un estilo inline le gana a cualquier clase. Resultado medido, en escritorio,
antes de tocar el scroll:

| Elemento | ¿Revelado? | transform inline | Desplazamiento Y |
|---|---|---|---|
| Tarjeta de proyecto | no | `perspective(1200px) scale(1)` | **0px** |
| Cualquier otro bloque | no | (ninguno) | **30px** |

**Las tarjetas de proyecto son el único bloque de la página que no se
desliza al entrar: solo aparecen.** Y como las dos primeras son las que ves
apenas llegás a la sección, es justo ahí donde se nota que algo va distinto
al resto. Eso es lo que estabas viendo.

En celular tampoco se deslizan, por otro motivo, así que el síntoma es el
mismo en los dos lados.

**Arreglo:** que el apilado escriba `scale()` en una variable CSS propia
(`--escala-apilado`) y que la clase componga las dos transformaciones, en vez
de que una pise a la otra. Es un cambio chico y no toca el efecto de apilado.

### Lo que NO era (y yo creía que sí)

Antes de encontrarlo me equivoqué dos veces, y lo anoto porque descarta dos
sospechas razonables:

- **Pensé que el apilado tenía un salto.** Lo recorrí de 50 en 50px por toda
  la sección: la escala baja de 1,000 a 0,860 de forma continua, sin ningún
  salto mayor a 0,02. El apilado está bien hecho.
- **Pensé que una transición de 0,8s hacía que la escala fuera arrastrada.**
  Falso: la transición real en esa tarjeta es `border-color, background-color`,
  no `transform`.

(También me equivoqué midiendo: `perspective()` genera `matrix3d`, no
`matrix`, y mi primer lector de escala devolvía 1,000 siempre. Si alguna vez
ves una medición mía que da todo igual, sospechá del medidor.)

---

## P1 — Lo que arreglaría antes que nada

### 1. Scroll horizontal en pantallas de 320px y 360px

Medido:

| Ancho | Desborde |
|---|---|
| 320px (iPhone SE) | **63px** |
| 360px (Android comunes) | **23px** |
| 390px en adelante | 0px |

No es un elemento suelto: es **un patrón**. `.container` es una grilla y a
320px su columna mide 272px, pero adentro hay hijos que se niegan a achicarse:

| Elemento | Ancho real | Columna disponible |
|---|---|---|
| `.contacto-info` | 359px | 272px |
| `.contacto-form` | 359px | 272px |
| `.cotizador-builder` | 313px | 272px |

La causa es la misma en los tres: un hijo de grilla nace con
`min-width: auto`, que le prohíbe achicarse por debajo del ancho mínimo de su
contenido. `.cotizador-container` ya tiene `min-width: 0` y por eso se porta
mejor que sus propios hijos.

**Impacto:** en un iPhone SE la página se mueve de costado. Es de las cosas
que más dan sensación de sitio mal hecho, y le pasa a un visitante que vino a
contratarte.

**Arreglo:** `min-width: 0` en los hijos de grilla, y revisar el `padding:
40px` de `.contacto-form`, que a 272px deja 192px útiles.

### 2. El botón de WhatsApp es casi ilegible

```
"Enviar Presupuesto por WhatsApp"
texto blanco sobre #25D366 → contraste 1.98:1
mínimo WCAG AA: 4.5:1
```

**1,98:1 es menos de la mitad del mínimo.** Y no es un texto decorativo: es
el botón que cierra el cotizador, el final del embudo de conversión.

El verde `#25D366` es el oficial de WhatsApp y entiendo querer respetarlo.
Hay salida sin perderlo: **texto oscuro** (`#0b2e13`) sobre ese mismo verde da
**9,1:1**. WhatsApp usa texto oscuro sobre verde claro en su propia interfaz,
así que no se ve raro.

### 3. Objetivos táctiles por debajo del mínimo

WCAG 2.5.8 pide 24×24px; la recomendación de 2.5.5 es 44×44px. Medidos:

| Elemento | Tamaño |
|---|---|
| `button.drawer-close` (cerrar el menú del celular) | **21×39** |
| Enlaces «Ver ventajas ↗» | 98×22 |
| `a.stack-card-link` («Visitar demo») | 113×23 |
| Casillas y radios del cotizador | **16×16**, 19×20, 20×20 |
| Enlaces del pie | 133×20, 149×20, 231×20 |

Los de 16px del cotizador son los peores: es un formulario que se usa con el
pulgar. **Arreglo:** padding vertical en los enlaces de texto (no cambia cómo
se ven) y agrandar el área clickeable de los controles del cotizador.

---

## P2 — Lo que arreglaría después

### 4. Niveles de título salteados

```
h3 «2 Agrega componentes…»  →  h5 «Adicionales:»
h2 «Hablemos de tu proyecto» →  h4 «¿Por qué trabajar conmigo?»
```

Un lector de pantalla navega por niveles; un salto se lee como si faltara
una sección. Es cambiar dos etiquetas, el estilo se mantiene con una clase.

### 5. Las imágenes no declaran su tamaño

Las 5 imágenes van sin `width`/`height`. El CLS medido dio **0,014** (muy
bueno), pero en mi prueba las imágenes no llegaban a cargar. Con imágenes
reales y una conexión lenta, el navegador no sabe cuánto espacio reservar y
el texto se mueve mientras cargan.

**Arreglo:** `width` y `height` en el HTML. No fija el tamaño visual — el CSS
sigue mandando — pero le da al navegador la proporción.

### 6. `will-change` que nunca se apaga

19 elementos tienen `will-change` activo **en reposo**:

```css
.reveal-on-scroll { will-change: opacity, transform; }
```

Esa clase nunca se saca después de revelarse. `will-change` le pide al
navegador una capa de GPU dedicada; es una pista para una animación puntual,
no algo para dejar prendido. En un celular de gama media son 19 capas
sostenidas sin motivo.

Además hay **19 elementos con `backdrop-filter`** (el efecto vidrio). Es de
los efectos más caros que existen, sobre todo en Android.

### 7. Dos contrastes más, por abajo del mínimo

| Texto | Contraste | Mínimo |
|---|---|---|
| «Ver ventajas ↗» (`--primary` sobre el fondo oscuro) | 4,02:1 | 4,5:1 |
| «Panel» en el pie (`--text-muted`) | 4,11:1 | 4,5:1 |

El de `--text-muted` ya te lo había marcado: tocarlo aclara **todos** los
textos secundarios del sitio, así que sigue siendo decisión tuya. El valor
mínimo que pasa es `#767f8e`.

---

## P3 — Detalles

- **Texto con degradado** en 3 lugares (`background-clip: text`). Se lee peor
  que un color sólido y es de los recursos más repetidos en sitios hechos con
  IA. Si te gusta el efecto, dejalo solo en el `h1`.
- **Bordes de color de 3px al costado** en 2 tarjetas: mismo caso.
- `transition: width` en `styles.css:2524` — animar `width` obliga a
  recalcular el layout en cada cuadro. Con `transform: scaleX()` el navegador
  no toca el layout.
- La tipografía es **Inter**, que está en todos lados. No es un error, pero
  si alguna vez querés que el sitio se distinga de entrada, es la palanca más
  barata que tenés.

---

## Lo que está bien y conviene no romper

El rendimiento es **muy bueno**, y no por casualidad:

| Métrica | Valor | Referencia |
|---|---|---|
| LCP | **1,48 s** | bueno < 2,5 s |
| CLS | **0,014** | bueno < 0,1 |
| Tareas largas | **1**, de 138 ms | — |
| Nodos del DOM | 660 | holgado |
| Imágenes sin `loading="lazy"` | **0** | — |

También están bien resueltos, y los verifiqué uno por uno:

- **Ningún** botón o enlace sin nombre accesible.
- **Ningún** campo de formulario sin etiqueta.
- **Ninguna** imagen sin `alt`.
- Landmarks correctos: un solo `<main>`, un solo `<h1>`, `lang="es"`.
- El deslizador de proyectos en celular: el `scroll-snap` funciona y los
  puntitos se sincronizan bien con la tarjeta visible en los tres primeros
  deslizamientos.
- El apilado de tarjetas en escritorio es suave y sin saltos.

---

## Por dónde empezaría

1. **El bug del scroll en los proyectos** — es el que vos mismo notaste, y es
   un cambio chico.
2. **El desborde en 320/360px** — un `min-width: 0` bien puesto arregla los
   tres casos de una.
3. **El contraste del botón de WhatsApp** — un color, y es el botón que
   cierra la venta.
4. **Los objetivos táctiles del cotizador** — mismo embudo.

Los tres primeros son una tarde corta. El resto puede esperar.
