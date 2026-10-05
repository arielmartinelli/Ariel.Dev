/**
 * Chequeo de contraste, para correr dentro del navegador con page.evaluate.
 *
 * Nace de un bug concreto: `.portal-resumen-link` se escribió para <a> y
 * también se usaba en <button>. Un <button> sin `background` NO es
 * transparente — el navegador le pone `buttonface` (gris claro) — así que
 * quedaba texto casi blanco sobre gris claro: contraste 1.1:1, ilegible.
 *
 * Mirando capturas no se encuentra: se ve "raro" pero uno supone que es el
 * tema oscuro. Midiendo aparece solo.
 */
export const CONTRASTE = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const alfa = (s) => { const p = (s.match(/[\\d.]+/g) || []); return p.length > 3 ? Number(p[3]) : 1; };

  /* El fondo efectivo: si el elemento es transparente, hay que subir por los
     padres hasta encontrar uno opaco. Comparar contra 'transparent' da
     numeros sin sentido. */
  const fondo = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (alfa(c) > 0.5) return rgb(c);
    }
    return rgb(getComputedStyle(document.body).backgroundColor) || [0, 0, 0];
  };

  const malos = [];
  for (const el of document.querySelectorAll("button, a, .btn, [role=button]")) {
    if (!el.getClientRects().length) continue;
    const texto = el.textContent.trim();
    if (!texto) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.3) continue;
    if (el.disabled) continue;

    const f = fondo(el), t = rgb(cs.color);
    if (!f.length || !t.length) continue;
    const a = lum(f), b = lum(t);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    /* 4.5:1 es el minimo de WCAG AA para texto normal; 3:1 para texto grande
       (>=18.66px en negrita o >=24px). Se usa el que corresponda. */
    const px = parseFloat(cs.fontSize);
    const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const minimo = grande ? 3 : 4.5;

    if (ratio < minimo) {
      malos.push(\`"\${texto.slice(0, 28)}" <\${el.tagName.toLowerCase()} class="\${el.className}"> \`
        + \`contraste \${ratio.toFixed(2)}:1 (minimo \${minimo}) · texto \${cs.color} sobre rgb(\${f.join(",")})\`);
    }
  }
  return [...new Set(malos)];
})()`;
