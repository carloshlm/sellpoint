import { useTranslation } from "react-i18next";

/**
 * El aviso de SANDBOX (2026-08-26).
 *
 * La MISMA imagen del front sirve en producción y en el sandbox — el build
 * no sabe en qué ambiente vive (VITE_API_URL es relativo a propósito). El
 * ambiente se detecta en RUNTIME por el hostname: cualquier
 * `sandbox.*` pinta la barra ámbar. Sin este aviso, capturar ventas reales
 * en el ambiente de pruebas es cuestión de tiempo — las dos pantallas son
 * idénticas pixel a pixel.
 *
 * `hostname` como prop con default: inyectable en tests sin parchear
 * window.location (que jsdom no deja reasignar).
 */
function SandboxBanner({ hostname = window.location.hostname }: { hostname?: string }) {
  const { t } = useTranslation();

  if (!hostname.startsWith("sandbox.")) {
    return null;
  }

  return (
    <div
      data-testid="sandbox-banner"
      className="bg-warning px-3 py-1 text-center text-xs font-semibold text-warning-foreground"
    >
      {t("common.sandboxBanner")}
    </div>
  );
}

export { SandboxBanner };
