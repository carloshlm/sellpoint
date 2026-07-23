import { api } from "./api";

const probe = await fetch("http://localhost:3000/health")
  .then((r) => r.ok)
  .catch(() => false);

describe("api instance", () => {
  it("tiene baseURL configurada", () => {
    expect(api.defaults.baseURL).toBe("http://localhost:3000");
  });
});

// Integración real contra el API — se saltea si el API no está corriendo
describe.runIf(probe)("api /health (integración)", () => {
  it("el frontend puede consumir /health", async () => {
    const { data } = await api.get("/health");

    expect(data).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
});
