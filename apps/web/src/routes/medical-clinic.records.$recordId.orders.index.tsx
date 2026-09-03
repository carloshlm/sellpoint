import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/medical-clinic/records/$recordId/orders/")({
  component: () => null,
});
