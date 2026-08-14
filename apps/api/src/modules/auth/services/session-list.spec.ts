import { groupSessionsByFamily } from "./session-list";

function row(overrides: { familyId: string; createdAt: string; expiresAt: string }) {
  return {
    familyId: overrides.familyId,
    createdAt: new Date(overrides.createdAt),
    expiresAt: new Date(overrides.expiresAt),
  };
}

describe("groupSessionsByFamily (F1-WEB-AUTH-10 — GET /auth/sessions)", () => {
  it("una familia con VARIOS tokens (rotación) colapsa en UNA sesión: createdAt del más viejo, expiresAt del más nuevo", () => {
    const sessions = groupSessionsByFamily(
      [
        row({
          familyId: "fam-a",
          createdAt: "2026-08-10T10:00:00Z",
          expiresAt: "2026-08-17T10:00:00Z",
        }),
        row({
          familyId: "fam-a",
          createdAt: "2026-08-12T10:00:00Z",
          expiresAt: "2026-08-19T10:00:00Z",
        }),
        row({
          familyId: "fam-a",
          createdAt: "2026-08-11T10:00:00Z",
          expiresAt: "2026-08-18T10:00:00Z",
        }),
      ],
      null,
    );

    expect(sessions).toEqual([
      {
        familyId: "fam-a",
        // Inicio de la SESIÓN = el login que abrió la familia.
        createdAt: new Date("2026-08-10T10:00:00Z"),
        // Muerte de la sesión = expiry del token VIGENTE (el último rotado).
        expiresAt: new Date("2026-08-19T10:00:00Z"),
        current: false,
      },
    ]);
  });

  it("familias distintas → sesiones distintas, ordenadas por inicio descendente (la más reciente primero)", () => {
    const sessions = groupSessionsByFamily(
      [
        row({
          familyId: "vieja",
          createdAt: "2026-08-01T10:00:00Z",
          expiresAt: "2026-08-08T10:00:00Z",
        }),
        row({
          familyId: "nueva",
          createdAt: "2026-08-13T10:00:00Z",
          expiresAt: "2026-08-20T10:00:00Z",
        }),
        row({
          familyId: "media",
          createdAt: "2026-08-07T10:00:00Z",
          expiresAt: "2026-08-14T10:00:00Z",
        }),
      ],
      null,
    );

    expect(sessions.map((s) => s.familyId)).toEqual(["nueva", "media", "vieja"]);
  });

  it("marca `current: true` SOLO en la familia de la cookie del request", () => {
    const sessions = groupSessionsByFamily(
      [
        row({
          familyId: "fam-a",
          createdAt: "2026-08-10T10:00:00Z",
          expiresAt: "2026-08-17T10:00:00Z",
        }),
        row({
          familyId: "fam-b",
          createdAt: "2026-08-11T10:00:00Z",
          expiresAt: "2026-08-18T10:00:00Z",
        }),
      ],
      "fam-b",
    );

    expect(sessions.find((s) => s.familyId === "fam-b")?.current).toBe(true);
    expect(sessions.find((s) => s.familyId === "fam-a")?.current).toBe(false);
  });

  it("sin familia actual conocida (sin cookie), ninguna sesión se marca como current", () => {
    const sessions = groupSessionsByFamily(
      [
        row({
          familyId: "fam-a",
          createdAt: "2026-08-10T10:00:00Z",
          expiresAt: "2026-08-17T10:00:00Z",
        }),
      ],
      null,
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(false);
  });

  it("sin tokens activos (todos revocados/expirados los filtró la query) → lista vacía", () => {
    expect(groupSessionsByFamily([], "fam-a")).toEqual([]);
  });

  it("NUNCA expone el hash del token, aunque venga en la fila", () => {
    const sessions = groupSessionsByFamily(
      [
        {
          ...row({
            familyId: "fam-a",
            createdAt: "2026-08-10T10:00:00Z",
            expiresAt: "2026-08-17T10:00:00Z",
          }),
          tokenHash: "hash-secretisimo",
        } as never,
      ],
      null,
    );

    expect(Object.keys(sessions[0] ?? {}).sort()).toEqual([
      "createdAt",
      "current",
      "expiresAt",
      "familyId",
    ]);
  });
});
