import { z } from "zod";

// F2-CAT-02: el tenant solo crea SUBCATÁLOGOS. `systemKey` e `isSystem` no
// son parte del DTO a propósito — el único catálogo del sistema lo crea
// `TenantsService.provision()` y nadie más puede fabricar otro por API.
export const createCatalogSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type CreateCatalogDto = z.infer<typeof createCatalogSchema>;
