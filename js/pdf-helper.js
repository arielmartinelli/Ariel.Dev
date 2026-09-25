/**
 * pdf-helper.js — Apertura segura de PDFs sin bloqueo about:blank#blocked.
 */
export function abrirDocumentoPdf(dataOrUrl, filename = "documento.pdf") {
  if (!dataOrUrl) return;
  const raw = String(dataOrUrl).trim();

  // Si es un Data URL en base64 de PDF, se convierte a Blob para evitar el bloqueo about:blank#blocked
  if (raw.startsWith("data:application/pdf")) {
    try {
      const parts = raw.split(",");
      const mime = parts[0].match(/:(.*?);/)?.[1] || "application/pdf";
      const base64Data = parts[1];
      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      const blobUrl = URL.createObjectURL(blob);

      const win = window.open(blobUrl, "_blank");
      if (!win) {
        // Fallback si el navegador bloqueó la ventana emergente
        const a = document.createElement("a");
        a.href = blobUrl;
        a.target = "_blank";
        a.download = filename || "documento.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      return;
    } catch (err) {
      console.error("Error convirtiendo Data URL a Blob URL:", err);
    }
  }

  // Si es un link HTTP/HTTPS estándar
  window.open(raw, "_blank", "noopener,noreferrer");
}
