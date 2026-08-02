# Protección de cuentas — 2FA

Con RLS cerrado, el backdoor eliminado y la CSP en `script-src 'self'`, **atacar tu código dejó de ser el camino más corto**. El camino más corto ahora es tu cuenta de Vercel, de Supabase o del dominio.

Quien entre a cualquiera de esas tres se saltea todo lo que hicimos:

| Si entran a... | Pueden... |
|---|---|
| **Vercel** | Desplegar el código que quieran en arieldev.com. Leer tus variables de entorno. |
| **Supabase** | Usar la `service_role` key, que **ignora las políticas RLS**. Acceso total a la base. |
| **Registrador del dominio** | Apuntar arieldev.com a otro servidor. Interceptar el correo del dominio. |

Ninguna de estas se defiende con código.

---

## 1. Supabase

**Account Settings → Security → Multi-Factor Authentication** → agregar una app de autenticación (TOTP).

> **Advertencia importante y poco conocida: Supabase NO te da códigos de recuperación.**
>
> Si perdés el celular con la app de autenticación, **no hay forma de recuperar la cuenta**. Supabase es explícito en su documentación: por razones de seguridad no pueden restaurar el acceso si perdés todas las credenciales de segundo factor.
>
> La recomendación oficial es **registrar un segundo factor TOTP de respaldo** — por ejemplo, la misma cuenta en un segundo dispositivo, o guardar el código semilla del QR en tu gestor de contraseñas.
>
> Hacé esto en el mismo momento en que activás el 2FA, no después.

Al activarlo, se cierran todas tus sesiones abiertas y tenés que volver a entrar.

## 2. Vercel

**Account Settings → Authentication** (o Security) → activar 2FA con app de autenticación o llave WebAuthn.

Vercel **sí** te da códigos de recuperación al terminar. Guardalos en tu gestor de contraseñas, no en el mismo celular donde está la app de autenticación.

## 3. Registrador del dominio

Depende de dónde compraste arieldev.com. Activá 2FA y, si lo ofrece, el **bloqueo de transferencia** (registrar lock / transfer lock). Verificá también que la renovación automática esté activa: un dominio vencido es tan grave como uno robado.

## 4. El email de recuperación

Las tres cuentas se recuperan por email. Si tu casilla no tiene 2FA, es el eslabón que anula a los otros tres.

Tu cuenta de Supabase y la del dominio están asociadas a tu Gmail. Activá 2FA ahí también, si no lo tenés.

---

## Orden sugerido

1. Email (es el que recupera a todos los demás)
2. Supabase — **con el factor de respaldo, sin excepción**
3. Vercel — guardando los códigos de recuperación
4. Registrador del dominio

Toma unos 15 minutos en total. Es lo de mayor impacto por tiempo invertido que te queda por hacer.

---

## Regla permanente

**Nunca uses la `service_role` key en el frontend ni la guardes en Vercel como variable `VITE_`.** Cualquier variable con prefijo `VITE_` termina incrustada en el bundle público. Esa clave ignora RLS: publicarla equivale a entregar la base entera.

Fuentes: [Supabase — Multi-factor Authentication](https://supabase.com/docs/guides/platform/multi-factor-authentication) · [Vercel — Two-factor Authentication](https://vercel.com/docs/two-factor-authentication)
