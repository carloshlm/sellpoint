/** Un capítulo tal como lo aprobó Carlos en la tabla del índice de `docs/manual/README.md`. */
export interface IndexEntry {
  /** Relativo a `docs/manual/es/`. */
  file: string;
  title: string;
  who: string;
  /** `null` cuando la columna dice «—»: el capítulo es de todos los planes. */
  plan: string | null;
  /** El renglón del README, para señalarlo. */
  line: number;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/**
 * La tabla del índice: la que tiene las columnas Capítulo, Archivo, Quién y
 * Plan. Las columnas se buscan por su nombre, y los renglones de parte (sin
 * archivo) se saltan.
 */
export function parseManualIndex(readme: string): IndexEntry[] {
  const lines = readme.split("\n");
  const headerAt = lines.findIndex((line) => {
    const names = line.startsWith("|") ? cells(line) : [];
    return ["Capítulo", "Archivo", "Quién", "Plan"].every((name) => names.includes(name));
  });
  if (headerAt < 0) {
    throw new Error(
      "No encontré la tabla del índice en docs/manual/README.md (columnas Capítulo, Archivo, Quién y Plan).",
    );
  }
  const header = cells(lines[headerAt] as string);
  const column = (name: string) => header.indexOf(name);
  const entries: IndexEntry[] = [];
  // El renglón de después del encabezado es el separador `|---|`.
  for (let index = headerAt + 2; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!line.startsWith("|")) break;
    const row = cells(line);
    const file = (row[column("Archivo")] ?? "").replace(/`/g, "");
    if (file === "") continue;
    const plan = row[column("Plan")] ?? "";
    entries.push({
      file,
      title: row[column("Capítulo")] ?? "",
      who: row[column("Quién")] ?? "",
      plan: plan === "" || plan === "—" ? null : plan,
      line: index + 1,
    });
  }
  return entries;
}
