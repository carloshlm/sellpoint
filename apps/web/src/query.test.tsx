import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

function Demo() {
  const { data } = useQuery({
    queryKey: ["demo"],
    queryFn: () => Promise.resolve("query funciona"),
  });

  return <p data-testid="query-result">{data ?? "cargando"}</p>;
}

describe("TanStack Query", () => {
  it("el provider resuelve queries", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Demo />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("query funciona")).toBeInTheDocument();
  });
});
