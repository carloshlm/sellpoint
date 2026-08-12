import { NoopMailer } from "./noop.mailer";

describe("NoopMailer", () => {
  it("no lanza y captura el mensaje enviado en sent[]", async () => {
    const mailer = new NoopMailer();
    const message = {
      to: "owner@example.com",
      template: "verify-email" as const,
      vars: { link: "https://app.example.com/verify-email?token=abc" },
      locale: "es" as const,
    };

    await expect(mailer.send(message)).resolves.toBeUndefined();
    expect(mailer.sent).toEqual([message]);
  });

  it("acumula varios envíos en orden", async () => {
    const mailer = new NoopMailer();

    await mailer.send({ to: "a@example.com", template: "verify-email", vars: {}, locale: "es" });
    await mailer.send({ to: "b@example.com", template: "verify-email", vars: {}, locale: "en" });

    expect(mailer.sent.map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
  });
});
