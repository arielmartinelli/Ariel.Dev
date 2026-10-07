(agregar esto a pruebas/LEEME.md)

**verificar-proyectos.mjs** — el landing con 3, 5 y 20 proyectos simulados y
la página /proyectos completa. Falla si: el landing dibuja más de 5, el botón
«Ver todos» aparece con 5 o menos (o falta con más), el botón queda tapado
por las tarjetas sticky, un filtro no filtra, aparece una categoría sin
proyectos, o hay scroll horizontal.

### Dos trampas que costaron un rato

1. **El preloader.** `#page-loader` es `position: fixed` con `z-index: 99999`
   y tapa la página entera hasta que termina su animación. Sin esperar a
   `#page-loader.hidden-loader`, CUALQUIER medición de "¿esto se puede
   clickear?" da que no, y la culpa parece del elemento medido. Esta prueba
   reportó el botón como tapado dos veces antes de que apareciera el
   verdadero responsable.

2. **Lenis.** La portada usa scroll suave, así que `scrollIntoView` no deja
   el elemento en su lugar final de inmediato. Midiendo al toque,
   `elementFromPoint` cae fuera de la pantalla y devuelve `null` — que no es
   "está tapado", es "no mediste nada". Por eso el scroll va en un paso
   aparte y con espera, y el chequeo solo falla con `false`, nunca con
   `null`.

### Algo que la prueba dejó a la vista

`getProjects()` NO devuelve una lista vacía cuando la tabla está vacía: cae a
`DEFAULT_PROJECTS`, cuatro proyectos de ejemplo con links a `example.com`.
Eso es de `js/projects.js` y es anterior a esta página. Si alguna vez la
tabla queda sin nada, el visitante ve esos cuatro de muestra.
