import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Alias histórico de `/verify-email` (la ruta real, que es la que el backend
 * pone en el mail). Se mantiene como redirect —preservando el `token` de la
 * query— para que cualquier link viejo, bookmark o mail ya enviado siga
 * funcionando. Barato de sostener; romper un link de verificación no lo es.
 */
export const Route = createFileRoute("/verify")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/verify-email", search: search as { token?: string }, replace: true });
  },
});
