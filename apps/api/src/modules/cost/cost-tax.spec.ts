import { Prisma } from "../../generated/prisma/client";
import { grossUnitCost, netUnitCost } from "./cost-tax";

const IVA = [{ code: "IVA", name: "IVA 16%", rate: "16" }];
const d = (v: string) => new Prisma.Decimal(v);

/** F9-COSTMODE-01 — el envoltorio Decimal no redondea por su cuenta: delega en shared. */
describe("netUnitCost / grossUnitCost (Decimal)", () => {
  it("$116.00 con IVA adentro son $100.00 netos; en excluded el Decimal vuelve intacto", () => {
    expect(netUnitCost(d("116"), IVA, "included").toString()).toBe("100");
    expect(netUnitCost(d("116"), IVA, "excluded").toString()).toBe("116");
  });

  it("$33.33 netos se vuelven $38.66 brutos y regresan a $33.33 (half-up en centavos)", () => {
    const bruto = grossUnitCost(d("33.33"), IVA, "included");
    expect(bruto.toString()).toBe("38.66");
    expect(netUnitCost(bruto, IVA, "included").toString()).toBe("33.33");
  });
});
