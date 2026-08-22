import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * F4-PWA-01 — el aviso de sin conexión.
 *
 * ── Por qué existe, y qué dice exactamente ──────────────────────────────
 *
 * La app abre sin red porque el service worker guarda el cascarón. Eso es
 * bueno y es peligroso a la vez: el cajero ve la pantalla de venta completa,
 * teclea un producto, y no pasa nada. Sin este aviso, la conclusión es «el
 * sistema se trabó».
 *
 * Por eso el texto no dice «sin conexión» a secas: dice **qué no se puede
 * hacer**. Un aviso que solo informa un estado obliga al usuario a deducir sus
 * consecuencias, y en un mostrador con gente esperando nadie deduce nada.
 *
 * ── Y por qué la venta NO funciona offline (decisión de F4) ─────────────
 *
 * Vender sin poder validar stock es regalar inventario: dos cajeros offline
 * venderían la misma última caja, y al volver la red el sistema tendría que
 * elegir a cuál de los dos clientes decepcionar. El día que haga falta, eso se
 * resuelve con reserva de stock y cola de sincronización — no escondiendo el
 * problema.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  // `navigator.onLine` como estado INICIAL y no solo por eventos: si la
  // pestaña se abre ya sin red, ningún `offline` va a dispararse nunca y el
  // aviso no aparecería jamás.
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const alConectar = () => setOnline(true);
    const alDesconectar = () => setOnline(false);
    window.addEventListener("online", alConectar);
    window.addEventListener("offline", alDesconectar);
    return () => {
      window.removeEventListener("online", alConectar);
      window.removeEventListener("offline", alDesconectar);
    };
  }, []);

  if (online) {
    return null;
  }

  return (
    <p
      role="alert"
      data-testid="offline-banner"
      className="bg-destructive px-4 py-2 text-center font-medium text-destructive-foreground text-sm"
    >
      {t("common.layout.offline")}
    </p>
  );
}
