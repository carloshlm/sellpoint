import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActiveSession } from "@/lib/auth/api";
import { useActiveSessions } from "@/lib/auth/hooks";

/**
 * Formatea según el idioma activo del usuario. Función pura y exportada: es
 * la única lógica real de este bloque, así que se puede probar sin montar
 * React.
 */
export function formatSessionDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * F1-WEB-AUTH-10 (presentacional). Una sesión = una FAMILIA de refresh tokens
 * viva. El backend NO guarda userAgent ni IP, así que acá no hay "Chrome en
 * Windows" que mostrar: solo cuándo empezó, cuándo vence y si es esta misma.
 * El `familyId` se usa como key de React pero NUNCA se muestra — es un
 * identificador interno, no información para el usuario.
 */
function SessionList({ sessions, locale }: { sessions: ActiveSession[]; locale: string }) {
  const { t } = useTranslation();

  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("auth.sessions.empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3" data-testid="active-sessions">
      {sessions.map((session) => (
        <li
          key={session.familyId}
          className="flex flex-col gap-1 rounded-md border border-border p-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {t("auth.sessions.startedAt", { date: formatSessionDate(session.createdAt, locale) })}
            </span>
            {session.current && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t("auth.sessions.current")}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {t("auth.sessions.expiresAt", { date: formatSessionDate(session.expiresAt, locale) })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Container: trae las sesiones y decide qué estado mostrar. */
function ActiveSessions() {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError } = useActiveSessions();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.sessions.title")}</CardTitle>
        <CardDescription>{t("auth.sessions.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("auth.sessions.loading")}
          </p>
        )}
        {isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("auth.sessions.error")}
          </p>
        )}
        {data && <SessionList sessions={data} locale={i18n.language} />}
      </CardContent>
    </Card>
  );
}

export { ActiveSessions, SessionList };
