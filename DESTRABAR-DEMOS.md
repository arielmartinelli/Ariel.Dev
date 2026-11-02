# Destrabar los demos para que se vean en vivo en el portfolio

Las tarjetas de `/proyectos` muestran el sitio de verdad adentro de un marco.
Diez de tus diecinueve demos lo prohíben con una cabecera, así que esos
muestran la captura vieja en vez del sitio andando.

Esto no está roto: funciona como tiene que funcionar. La captura es el
respaldo. Pero si querés que esos diez también se vean en vivo, hay que
tocar una línea en cada uno.

## Los que están bloqueados hoy

Medido el 2 de noviembre de 2026 pidiéndole las cabeceras a cada sitio:

| Proyecto | Cabecera que lo bloquea |
|---|---|
| Estudio Jurídico Jaime Casa Toledo ⭐ | `X-Frame-Options: deny` |
| Delta Tigre ⭐ | `X-Frame-Options: sameorigin` |
| Turnero Pro | `X-Frame-Options: deny` |
| Mi Barrio Bar | `X-Frame-Options: deny` |
| Sarvach Barberia ⭐ | `X-Frame-Options: sameorigin` |
| pedilo ⭐ | `X-Frame-Options: deny` |
| Rapaz Abogado | `X-Frame-Options: deny` |
| Departamentos La Fe | `X-Frame-Options: sameorigin` |
| Demo concesionaria | `X-Frame-Options: sameorigin` |
| Concesionaria Demo | `X-Frame-Options: sameorigin` |

⭐ = destacado en el portfolio. Son los cuatro que ocupan la fila entera, o
sea los que más se notan.

Los otros nueve (Fymcor, La Juntada, Mooving, Chape, Magica Studio, Iphone
cba, Abel Fitness, RR Patagonia, Estudio Alonso) ya se ven en vivo.

## Qué hay que cambiar

`X-Frame-Options` es de 2009 y solo entiende "nadie" o "yo mismo": no hay
forma de decirle "dejá entrar a arieldev.com". Lo que la reemplaza es
`Content-Security-Policy: frame-ancestors`, que sí acepta una lista.

Entonces en cada proyecto: **sacar `X-Frame-Options` y poner en su lugar**

```
Content-Security-Policy: frame-ancestors 'self' https://arieldev.com
```

Eso sigue bloqueando a todo el mundo, igual que antes. La única diferencia
es que tu portfolio queda en la lista de invitados.

### Si el proyecto tiene `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "" },
        { "key": "Content-Security-Policy",
          "value": "frame-ancestors 'self' https://arieldev.com" }
      ]
    }
  ]
}
```

Si ya tenés un bloque `headers`, agregá la línea de `Content-Security-Policy`
ahí adentro y **borrá** la de `X-Frame-Options`. Dejar las dos no sirve: la
vieja gana en varios navegadores.

### Si es Next.js (`next.config.js`)

```js
async headers() {
  return [{
    source: "/(.*)",
    headers: [
      { key: "Content-Security-Policy",
        value: "frame-ancestors 'self' https://arieldev.com" },
    ],
  }];
}
```

Y borrar la entrada de `X-Frame-Options` si está.

### Si el bloqueo no está en el código

Algunos frameworks la ponen solos, y Vercel también la agrega en los
proyectos creados con ciertas plantillas. Si no encontrás la cabecera en
ningún archivo, poné igual el bloque de `vercel.json` de arriba con
`X-Frame-Options` en `""`: eso la pisa.

## Cómo saber si quedó bien

Después de desplegar, en la terminal:

```bash
curl -sI https://tu-demo.vercel.app | grep -iE "x-frame-options|content-security"
```

Tiene que aparecer solo la línea de `Content-Security-Policy` con
`frame-ancestors`, y **ninguna** de `X-Frame-Options`.

No hace falta tocar nada en el portfolio: `/api/marco-permite` vuelve a
preguntar una vez por día y la tarjeta pasa sola a mostrarse en vivo. Si
querés verlo al toque, el CDN de Vercel cachea esa respuesta 24 horas: un
redeploy del portfolio la limpia.

## Y si preferís no tocar nada

No pasa nada. La tarjeta muestra la captura guardada, que es exactamente lo
que se veía antes. Lo único que perdés es el sitio moviéndose.

En ese caso, **no corras `migracion-17-liberar-portadas.sql`**: esas
capturas son lo único que tienen esas diez tarjetas.
