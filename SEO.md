# Auditoría SEO — arieldev.com

**Fecha:** 2 de agosto de 2026
**Alcance:** `index.html` + las 5 páginas `ventajas-*`

---

## Resumen

La base está bien: `lang="es"`, un solo `H1` por página, jerarquía de encabezados correcta, títulos con buena longitud, HTTPS, mobile-first y ahora carga rápida. Eso ya te pone por encima de la mayoría de los portfolios.

El problema no es la calidad de las páginas, es que **cinco de tus seis páginas son invisibles para Google.**

Las páginas `ventajas-*` son tu mejor contenido para posicionar: responden búsquedas reales como *"conviene tener una landing page"* o *"ventajas de una tienda online"*. Hoy no las puede encontrar nadie.

| Severidad | Hallazgos | Estado |
|---|---|---|
| Crítica | 3 | SEO-02 y SEO-03 corregidos · SEO-01 pendiente |
| Alta | 4 | SEO-05, SEO-06 y SEO-07 (home) corregidos · SEO-04 pendiente |
| Media | 3 | SEO-08 y SEO-09 corregidos · SEO-10 pendiente |

### Aplicado el 2 de agosto de 2026

- Open Graph y Twitter Card con URLs absolutas, `og:description` real, `og:site_name`, `og:locale` y `og:image:alt`
- JSON-LD apuntando a `https://arieldev.com/` en lugar de GitHub; agregados `email`, `areaServed` y `availableLanguage`
- `public/sitemap.xml` con las 6 páginas
- `public/robots.txt` declarando el sitemap
- `<link rel="canonical">` en la home
- Meta description recortada de 202 a 155 caracteres
- `meta keywords` eliminada

### Pendiente

- **SEO-01** — enlaces `<a href>` reales a las páginas `ventajas-*` (el de mayor impacto)
- **SEO-04** — meta descriptions de las 5 páginas `ventajas-*`
- **SEO-07** — canonical en las 5 páginas `ventajas-*`
- **SEO-10** — `og-banner.png` a JPG (570 KB → ~120 KB)
- **SEO-11** — enlaces sociales del footer apuntan a las home de GitHub, LinkedIn e Instagram, no a tus perfiles. Sin URLs reales no se puede completar `sameAs` en el JSON-LD, que es lo que le confirma a Google que esos perfiles son tuyos.
- Alta en **Google Search Console** y envío del sitemap

---

## CRÍTICO

### SEO-01 · Las 5 páginas `ventajas-*` son inalcanzables para Google

Se llega a ellas solo por JavaScript:

```js
window.location.href = `ventajas-${service}.html`;
```

Googlebot ejecuta JavaScript, pero **no pulsa botones**. Descubre páginas siguiendo enlaces `<a href>`, y no existe ni uno solo que apunte a esas páginas. Sin sitemap que las declare, son páginas huérfanas: publicadas, pero fuera del índice.

Es tu contenido con más potencial de tráfico orgánico y no está compitiendo.

**Solución:** que el selector sea un `<a href>` real (puede seguir viéndose igual y comportándose igual), y declararlas en el sitemap. Además, enlaces contextuales desde la sección de servicios de la home: "Landing Pages → ver ventajas".

### SEO-02 · No existe `sitemap.xml` ni `robots.txt`

Google no tiene forma de saber qué páginas tenés ni cuáles priorizar. El sitemap es lo que compensa el problema anterior mientras se arregla el enlazado.

`robots.txt` además debe apuntar al sitemap.

### SEO-03 · Los datos estructurados apuntan a GitHub

En el JSON-LD de `index.html`:

```json
"url": "https://github.com/arielmartinelli/Ariel.Dev",
"image": "https://github.com/arielmartinelli/Ariel.Dev/raw/main/public/images/og-banner.png"
```

Le estás declarando a Google que **la web oficial de tu negocio es un repositorio de GitHub**. Los datos estructurados alimentan el panel de negocio local; con la URL equivocada, el trabajo que hiciste con `ProfessionalService`, geolocalización y horarios beneficia a la URL incorrecta.

El resto del bloque está bien armado: `ProfessionalService`, dirección, coordenadas y horarios son correctos.

**Solución:** cambiar ambos campos a `https://arieldev.com/`. Y agregar `sameAs` con tus perfiles reales.

---

## ALTO

### SEO-04 · Las 5 páginas `ventajas-*` no tienen meta description

Ninguna. Google inventa el fragmento tomando texto suelto de la página, que casi siempre queda peor que uno escrito a propósito. Es lo que decide si alguien hace clic.

### SEO-05 · `og:image` y `og:url` son rutas relativas

```html
<meta property="og:url" content="/">
<meta property="og:image" content="/images/og-banner.png">
```

Open Graph **exige URLs absolutas**. Los rastreadores de WhatsApp, LinkedIn y Facebook leen la etiqueta fuera del contexto de tu dominio y no pueden resolver `/images/...`.

Consecuencia concreta: cuando compartís arieldev.com por WhatsApp, la vista previa sale sin imagen o directamente rota. Es tu principal canal de contacto.

**Solución:** `https://arieldev.com/` y `https://arieldev.com/images/og-banner.png`.

### SEO-06 · `og:description` genérica

```html
<meta property="og:description" content="Desarrollador web freelance">
```

27 caracteres, contra los 202 de tu meta description normal. Es el texto que se ve al compartir el link. Debería vender igual que el otro.

### SEO-07 · Sin etiqueta canonical

Ninguna de las 6 páginas la tiene. Sin canonical, `arieldev.com`, `www.arieldev.com`, `arieldev.com/` y `arieldev.com/index.html` pueden tratarse como páginas distintas con contenido idéntico, dividiendo la autoridad entre versiones.

---

## MEDIO

### SEO-08 · Meta description de la home: 202 caracteres

Google corta alrededor de los 155-160. Los últimos 45 caracteres —incluido el "¡Cotiza tu proyecto hoy!"— no se ven nunca. Conviene recortarla poniendo lo importante al principio.

### SEO-09 · `meta keywords` obsoleta

Google la ignora desde 2009. No penaliza, pero le muestra a cualquier competidor tu estrategia de palabras clave. Se puede borrar.

### SEO-10 · `og-banner.png` pesa 570 KB

No afecta el ranking directamente, pero algunos rastreadores de redes sociales abandonan la descarga si tarda demasiado, y la vista previa queda sin imagen. Convertida a JPG baja a ~120 KB sin pérdida visible.

---

## Lo que ya está bien

No hace falta tocar nada de esto:

- `lang="es"` correcto
- Un solo `H1` por página, jerarquía sin saltos
- Títulos entre 48 y 63 caracteres, dentro del rango útil
- La única `<img>` del HTML tiene `alt`
- HTTPS forzado con HSTS
- Meta description de la home bien redactada (solo hay que acortarla)
- JSON-LD con `ProfessionalService`, dirección, geo y horarios: buena estructura, mal la URL
- Rendimiento: la carga inicial bajó 68%, y la velocidad sí es factor de ranking en mobile

---

## Orden de ejecución sugerido

Por impacto sobre esfuerzo:

1. **SEO-05 y SEO-06** — Open Graph absoluto. 5 minutos, y arregla las vistas previas de WhatsApp hoy mismo.
2. **SEO-03** — corregir la URL de los datos estructurados. 2 minutos.
3. **SEO-02** — crear `sitemap.xml` y `robots.txt`. 10 minutos.
4. **SEO-01** — enlaces `<a href>` reales a las páginas `ventajas-*`. Es el de mayor impacto a mediano plazo y el que más trabajo lleva.
5. **SEO-04** — escribir las 5 meta descriptions.
6. **SEO-07** — canonical en las 6 páginas.
7. **SEO-08, SEO-09, SEO-10** — ajustes menores.

Después de aplicarlos: dar de alta el sitio en **Google Search Console**, enviar el sitemap y pedir indexación de las páginas `ventajas-*`. Sin eso, los cambios tardan semanas en notarse.

---

## Advertencia sobre expectativas

El SEO técnico saca los obstáculos: garantiza que Google pueda encontrar, entender e indexar tus páginas. No genera tráfico por sí solo.

Para consultas competitivas como *"desarrollador web córdoba"* vas a competir con agencias que tienen años de antigüedad de dominio y backlinks. Lo realista con esto corregido es posicionar en búsquedas de cola larga —*"cuánto sale una landing page en córdoba"*, *"ventajas de tienda online argentina"*— que es exactamente lo que responden tus páginas `ventajas-*`.

Por eso SEO-01 es el hallazgo que más importa a mediano plazo, aunque no sea el más rápido de arreglar.
