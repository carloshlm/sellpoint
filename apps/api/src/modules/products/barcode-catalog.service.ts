import { Injectable } from "@nestjs/common";
import { classifyGtin, cleanGtin } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";

/** El producto que ESTE negocio ya tiene con ese código. */
export interface BarcodeTenantHit {
  productId: string;
  presentationId: string;
  sku: string;
  name: string;
  /** El precio de la presentación que lleva el código, no el del producto. */
  price: string | null;
}

/** El nombre que el catálogo compartido sugiere para ese código. */
export interface BarcodeGlobalHit {
  name: string;
  brand: string | null;
  unitSize: string | null;
}

export interface BarcodeLookupResult {
  /**
   * `tenant`: el negocio ya lo tiene · `global`: lo conoce el catálogo
   * compartido · `unknown`: nadie lo conoce todavía.
   */
  status: "tenant" | "global" | "unknown";
  /**
   * El código con el que hay que dar de alta: sin espacios ni guiones si es
   * un GTIN, literal si es un código propio del negocio.
   */
  code: string;
  /** La clave canónica, o `null` si el código no es un GTIN. */
  gtin14: string | null;
  tenant: BarcodeTenantHit | null;
  global: BarcodeGlobalHit | null;
  /**
   * Si este código PODRÍA sumarse al catálogo compartido cuando se dé de alta.
   * Es falso para los de circulación restringida —la etiqueta de báscula, la
   * marca blanca— y para lo que no es un GTIN.
   */
  contributable: boolean;
}

/**
 * F10-QUICKCAT-02 — el buscador de la carga rápida: una cascada de dos pasos.
 *
 * ── Por qué el catálogo del negocio va primero ──────────────────────────
 *
 * Porque el nombre que el negocio ya le puso a su producto gana SIEMPRE sobre
 * el del catálogo compartido. Si alguien registró «Coca 600» y el catálogo
 * global dice «Coca-Cola Original 600 ml», mostrar el segundo invitaría a
 * pisar el primero, y la carga rápida no está para renombrarle el catálogo a
 * nadie. El corte además ahorra la segunda consulta.
 *
 * ── Por qué el catálogo global se consulta sin contexto de negocio ──────
 *
 * `global_barcode_catalog` no tiene tenant ni RLS, como `permissions` o el
 * catálogo CIE-10: un código de barras significa lo mismo en todos lados. Se
 * consulta con `PrismaService` directo, NO dentro de `withTenantContext`
 * (mismo molde que `Icd10Service`).
 *
 * ── Un código que no es un GTIN no es un error ──────────────────────────
 *
 * La etiqueta que imprime la báscula del negocio, o un código interno tecleado
 * a mano, son códigos legítimos PARA ÉL. Por eso el catálogo propio se busca
 * igual —por el texto literal— y la respuesta es `unknown`, no un rechazo: la
 * pantalla deja capturar el nombre y el producto se crea. Lo único que ese
 * código nunca hace es entrar al catálogo que comparten todos.
 */
@Injectable()
export class BarcodeCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(user: AuthUser, rawCode: string): Promise<BarcodeLookupResult> {
    const gtin = classifyGtin(rawCode);
    // Los espacios y guiones se quitan solo si es un GTIN: en un código
    // interno del negocio el guion es parte del código, y limpiarlo buscaría
    // un «INTERNO42» que no existe.
    const code = gtin === null ? rawCode.trim() : cleanGtin(rawCode);
    // Las escrituras equivalentes del mismo GTIN: los productos guardan el
    // código TAL COMO SE ESCANEÓ, así que `7501055300013` y su forma con cero
    // adelante son el mismo anaquel.
    const formas = gtin === null ? [code] : gtin.variants;

    const propio = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.productPresentation.findFirst({
        where: { barcode: { in: formas }, isActive: true, product: { isActive: true } },
        select: {
          id: true,
          price: true,
          product: { select: { id: true, sku: true, name: true } },
        },
        orderBy: { factor: "asc" },
      }),
    );

    if (propio !== null) {
      return {
        status: "tenant",
        code,
        gtin14: gtin?.gtin14 ?? null,
        tenant: {
          productId: propio.product.id,
          presentationId: propio.id,
          sku: propio.product.sku,
          name: propio.product.name,
          price: propio.price?.toString() ?? null,
        },
        global: null,
        contributable: false,
      };
    }

    if (gtin === null) {
      return {
        status: "unknown",
        code,
        gtin14: null,
        tenant: null,
        global: null,
        contributable: false,
      };
    }

    const compartido = await this.prisma.globalBarcodeCatalog.findUnique({
      where: { gtin14: gtin.gtin14 },
      select: { productName: true, brand: true, unitSize: true },
    });

    const contributable =
      compartido === null && gtin.prefix !== null && (await this.esPrefijoImportable(gtin.prefix));

    return {
      status: compartido === null ? "unknown" : "global",
      code,
      gtin14: gtin.gtin14,
      tenant: null,
      global:
        compartido === null
          ? null
          : {
              name: compartido.productName,
              brand: compartido.brand,
              unitSize: compartido.unitSize,
            },
      contributable,
    };
  }

  /**
   * Si el prefijo GS1 admite entrar al catálogo compartido.
   *
   * Los rangos viven en la base y no en una constante: cuando GS1 asigna un
   * país nuevo se actualiza una tabla, no se despliega el API. Sin rango que
   * lo contenga la respuesta es NO, igual que en el sembrador: lo que no se
   * puede ubicar no se aporta.
   */
  private async esPrefijoImportable(prefix: string): Promise<boolean> {
    const rango = await this.prisma.gs1PrefixRange.findFirst({
      where: { prefixFrom: { lte: prefix }, prefixTo: { gte: prefix } },
      select: { isImportable: true },
    });
    return rango?.isImportable === true;
  }
}
