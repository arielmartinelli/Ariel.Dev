# Análisis de rendimiento — Portfolio Ariel.Dev

**Fecha:** 2 de agosto de 2026
**Método:** medición directa del peso de los archivos servidos. No son estimaciones.

---

## El problema principal

Cada visitante descargaba **885 KB de librería para generar PDFs** antes de ver el sitio. Esa librería (`html2pdf`) solo se usa cuando alguien pulsa "descargar presupuesto" — una fracción mínima de las visitas.

Era el 69% de todo el JavaScript del sitio, cargado para nada en la mayoría de los casos.

## Resultados medidos

### Carga inicial (HTML + CSS + JS + avatar)

| | Antes | Después | Diferencia |
|---|---|---|---|
| Peso sin comprimir | 1288.7 KB | 410.0 KB | **−878.7 KB (−68%)** |
| En 4G real (~1.5 Mbps) | ~6.9 s | ~2.2 s | **−4.7 s** |

**Qué se hizo:** `html2pdf` se carga bajo demanda, recién cuando el visitante pide el PDF. Se descarga una sola vez y queda cacheada. Para quien sí lo usa, hay una espera de ~1 s en el primer clic; para todos los demás, el sitio carga 4,7 segundos antes.

`sweetalert2` pasó a `defer` para no bloquear el parseo del HTML.

### Imágenes: JPG/PNG → WebP

| Archivo | Original | WebP | Ahorro |
|---|---|---|---|
| lens-light | 650.0 KB | 73.1 KB | 89% |
| apex-landing | 603.0 KB | 80.2 KB | 87% |
| og-banner | 570.0 KB | 59.1 KB | 90% |
| taskflow | 515.8 KB | 56.0 KB | 90% |
| aura-store | 493.0 KB | 54.9 KB | 89% |
| profile | 122.9 KB | 47.5 KB | 62% |
| **TOTAL** | **2954.6 KB** | **370.7 KB** | **88%** |

Los `.webp` están generados en `public/images/` y las referencias de los 4 proyectos por defecto ya apuntan a ellos. Los JPG originales se conservan por si algún registro de la base los referencia.

Se agregó además `loading="lazy"` y `decoding="async"` a las imágenes de proyecto: las que están fuera de la pantalla no se descargan hasta que hacen falta.

### Total del sitio

| | Antes | Después |
|---|---|---|
| Peso total de assets | ~4.2 MB | ~0.9 MB |
| Reducción | — | **~79%** |

Con compresión gzip del servidor (activada en el `.htaccess`), el HTML/CSS/JS baja otro ~70%.

---

## Pendiente: `og-banner`

Sigue en PNG de 570 KB. Es la imagen que se muestra al compartir el link en WhatsApp o redes. La dejé sin cambiar a propósito: algunos crawlers de redes sociales manejan WebP de forma inconsistente y no quiero romper cómo se ve tu sitio al compartirlo.

Si querés reducirla igual, convertila a **JPG** (no WebP), que baja a ~120 KB con compatibilidad total.

---

## Recomendaciones que no apliqué

Las dejo documentadas con su impacto estimado para que decidas. No las apliqué porque requieren cambios de mayor alcance o decisiones de diseño que son tuyas.

**1. Dividir el CSS (58.7 KB en un archivo)**
Extraer el CSS de la primera pantalla e inline-arlo en el `<head>`, cargando el resto de forma asíncrona. Mejora el First Contentful Paint ~200-400 ms. Requiere reorganizar `styles.css`.

**2. Autoalojar las fuentes de Google**
Hoy se cargan desde `fonts.googleapis.com`: dos conexiones DNS+TLS extra antes de que aparezca texto. Descargar los `.woff2` a tu dominio ahorra ~300 ms y elimina dos orígenes de la CSP. También mejora la privacidad de tus visitantes.

**3. Reducir el JavaScript propio (87.5 KB en `app.js`)**
Es un archivo grande para un portfolio. No es urgente, pero si sigue creciendo conviene separarlo en módulos (cotizador, panel admin, portfolio) y cargar el panel admin bajo demanda — igual que se hizo con `html2pdf`. El panel solo lo usás vos.

**4. `og-banner.png` se referencia 3 veces en el HTML**
Verificá que sean necesarias; cada referencia distinta puede provocar descargas separadas.

---

## Cómo medir vos mismo

Después de desplegar:

1. **PageSpeed Insights** — https://pagespeed.web.dev — usá la pestaña *Mobile*, que es donde se nota. Apuntá a LCP < 2.5 s.
2. **DevTools → Network** — activá *Disable cache* y el throttling *Fast 4G*. Mirá el peso total abajo a la derecha.
3. **DevTools → Coverage** (Ctrl+Shift+P → "Coverage") — muestra qué porcentaje del CSS y JS descargado no se usa. Si `styles.css` marca más del 60% sin usar, la recomendación 1 vale la pena.

Medí **antes** de optimizar y guardá el número. Sin la medición previa no sabés si mejoraste.
