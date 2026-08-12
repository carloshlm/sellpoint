import type { Prisma } from "../../generated/prisma/client";
import { AuditService } from "./audit.service";

describe("AuditService.record (f1-auth AD-10)", () => {
  it("invoca auditLog.create dentro del tx recibido, con los campos de la entry", async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
    const service = new AuditService();

    await service.record(tx, {
      tenantId: "tenant-1",
      userId: "user-1",
      action: "auth.register_tenant",
      resourceType: "tenant",
      resourceId: "tenant-1",
      ip: "127.0.0.1",
      userAgent: "jest",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        userId: "user-1",
        action: "auth.register_tenant",
        resourceType: "tenant",
        resourceId: "tenant-1",
        before: undefined,
        after: undefined,
        ip: "127.0.0.1",
        userAgent: "jest",
      },
    });
  });

  it("no requiere userId (eventos sin actor humano, ej. provisioning)", async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
    const service = new AuditService();

    await service.record(tx, {
      tenantId: "tenant-1",
      action: "auth.email.verified",
      resourceType: "user",
    });

    expect(create).toHaveBeenCalledTimes(1);
  });
});
