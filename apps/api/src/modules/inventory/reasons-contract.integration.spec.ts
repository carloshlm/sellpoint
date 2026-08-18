import { ConfigService } from "@nestjs/config";
import {
  MOVEMENT_DIRECTIONS,
  MOVEMENT_REASONS,
  REASONS_BY_DIRECTION,
  TRANSFER_STATUSES,
} from "@sellpoint/shared";
import type { Env } from "../../config/env.schema";
import { MovementDirection, MovementReason, TransferStatus } from "../../generated/prisma/enums";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * F3-CORE-01 — el contrato entre las CUATRO fuentes que tienen que decir lo
 * mismo sobre los motivos:
 *
 *   1. `MOVEMENT_REASONS` en `packages/shared` (lo que ve el front),
 *   2. el enum `MovementReason` de Prisma (lo que acepta el ORM),
 *   3. el tipo `MovementReason` de Postgres (lo que acepta la columna),
 *   4. el CHECK dirección×motivo de la migración de F3-DB-01.
 *
 * Divergir es fácil y silencioso: alguien agrega un motivo al enum, el
 * formulario nunca lo ofrece, o —peor— el front ofrece uno que el CHECK
 * rechaza y el usuario se come un 500 al confirmar. Este test lo caza en CI.
 *
 * Mismo molde que `UNITS` contra la tabla `units` (F2-UOM-01).
 */
describe("contrato de motivos: shared ↔ Prisma ↔ Postgres (F3-CORE-01)", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("los motivos de shared y los del enum de Prisma son los mismos", () => {
    expect([...MOVEMENT_REASONS].sort()).toEqual(Object.values(MovementReason).sort());
  });

  it("las direcciones y los estados de traspaso también", () => {
    expect([...MOVEMENT_DIRECTIONS].sort()).toEqual(Object.values(MovementDirection).sort());
    expect([...TRANSFER_STATUSES].sort()).toEqual(Object.values(TransferStatus).sort());
  });

  it("el tipo de Postgres tiene exactamente esos valores", async () => {
    const rows = await prisma.$queryRaw<{ label: string }[]>`
      SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'MovementReason'`;

    expect(rows.map((r) => r.label).sort()).toEqual([...MOVEMENT_REASONS].sort());
  });

  /**
   * El más valioso de los cuatro: lee el CHECK REAL de la base y verifica que
   * cada combinación que shared declara válida esté adentro, y que ninguna que
   * declara inválida lo esté. Sin esto, agregar un motivo a
   * `REASONS_BY_DIRECTION` sin tocar la migración deja al front ofreciendo algo
   * que la base rechaza.
   */
  it("el CHECK dirección×motivo de la migración coincide con REASONS_BY_DIRECTION", async () => {
    const [row] = await prisma.$queryRaw<{ definition: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'stock_movements'
         AND c.conname = 'stock_movements_direction_reason_check'`;
    const definition = row?.definition ?? "";

    const violations: string[] = [];
    for (const direction of MOVEMENT_DIRECTIONS) {
      // El CHECK agrupa por dirección; se recorta el tramo de cada una para no
      // confundir los motivos de entry con los de exit.
      const marker = `direction = '${direction}'`;
      const from = definition.indexOf(marker);
      const to =
        direction === "entry" ? definition.indexOf("direction = 'exit'") : definition.length;
      const chunk = definition.slice(from, to === -1 ? definition.length : to);

      for (const reason of MOVEMENT_REASONS) {
        const permitidoEnShared = REASONS_BY_DIRECTION[direction].includes(reason);
        const permitidoEnCheck = chunk.includes(`'${reason}'`);
        if (permitidoEnShared !== permitidoEnCheck) {
          violations.push(
            `${direction}+${reason}: shared=${permitidoEnShared} check=${permitidoEnCheck}`,
          );
        }
      }
    }

    expect(definition).not.toBe("");
    expect(violations).toEqual([]);
  });
});
