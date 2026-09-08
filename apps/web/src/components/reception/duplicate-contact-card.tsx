import { fullName } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import type { Customer } from "@/lib/reception/api";
import { useCustomers } from "@/lib/reception/hooks";
import { useReceptionEntity } from "@/lib/reception/settings";

/** El contacto ya COMPROBADO (al salir del campo), no el que se está tecleando. */
export interface CheckedContact {
  phone: string | null;
  email: string | null;
}

/**
 * Coincidencia EXACTA en cliente: el API busca por `contains` (sirve para el
 * buscador del listado), pero acá «rosa@yopmail.com.mx» NO es el mismo correo
 * que «rosa@yopmail.com». El correo se compara sin caja; el teléfono ya es
 * E.164 canónico. En edición, el propio registro no cuenta como repetido.
 */
export function matchingContacts(
  rows: Customer[],
  contact: CheckedContact,
  excludeId?: string,
): Customer[] {
  const email = contact.email?.toLowerCase() ?? null;
  const vistos = new Set<string>();
  return rows.filter((row) => {
    if (row.id === excludeId || vistos.has(row.id)) return false;
    const mismoTelefono = contact.phone !== null && row.phone === contact.phone;
    const mismoCorreo = email !== null && row.email?.toLowerCase() === email;
    if (!mismoTelefono && !mismoCorreo) return false;
    vistos.add(row.id);
    return true;
  });
}

/**
 * Carlos, 2026-09-08: si ya hay un paciente con ese teléfono o correo, el
 * sistema AVISA y ofrece editarlo, pero NO bloquea. Padre e hijo comparten
 * contacto todo el tiempo (la persona mayor sin correo la registra su hijo),
 * así que la base no tiene UNIQUE y esta tarjeta tampoco lo inventa.
 *
 * Busca con el mismo endpoint del listado, una consulta por dato, y filtra la
 * coincidencia exacta en cliente. Sin permiso de lectura de Recepción (el
 * consultorio da de alta con el mismo formulario) no consulta nada.
 */
export function DuplicateContactCard({
  contact,
  excludeId,
}: {
  contact: CheckedContact;
  excludeId?: string;
}) {
  const { t } = useTranslation();
  const entidad = useReceptionEntity();
  const { has } = usePermissions();
  const puedeBuscar = has("reception:read");
  const porTelefono = useCustomers(
    { query: contact.phone ?? undefined },
    { enabled: puedeBuscar && contact.phone !== null },
  );
  const porCorreo = useCustomers(
    { query: contact.email ?? undefined },
    { enabled: puedeBuscar && contact.email !== null },
  );
  const filas = [
    ...(contact.phone !== null ? (porTelefono.data?.rows ?? []) : []),
    ...(contact.email !== null ? (porCorreo.data?.rows ?? []) : []),
  ];
  const repetidos = matchingContacts(filas, contact, excludeId);
  if (repetidos.length === 0) return null;

  return (
    <section
      data-testid="duplicate-contact"
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-soft px-4 py-3 text-sm"
    >
      <p className="font-medium">
        {t("reception.form.duplicates.title", { count: repetidos.length, ...entidad.vars })}
      </p>
      <p className="text-muted-foreground">{t("reception.form.duplicates.hint")}</p>
      <ul className="flex flex-col divide-y divide-warning/40">
        {repetidos.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="font-medium">{fullName(row)}</span>
            {row.age !== null && (
              <span className="text-muted-foreground">
                {t("reception.customers.years", { count: row.age })}
              </span>
            )}
            {row.phone && <span className="tabular-nums">{row.phone}</span>}
            {row.email && <span>{row.email}</span>}
            {has("reception:manage") && (
              <Link
                to="/reception/customers/$customerId"
                params={{ customerId: row.id }}
                className="ml-auto font-medium text-primary hover:underline"
              >
                {t("common.actions.edit")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
