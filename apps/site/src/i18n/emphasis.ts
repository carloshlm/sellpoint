// La palabra subrayada de un titular va marcada con *asteriscos* DENTRO del
// texto («Cobra en *segundos*, no en filas.»). Así quien traduce decide cuál
// palabra se subraya en su idioma, y el componente no sabe nada de gramática.

export interface EmphasisPart {
  text: string;
  emphasis: boolean;
}

export function splitEmphasis(text: string): EmphasisPart[] {
  const pieces = text.split("*");
  // Un número par de trozos es un asterisco sin pareja. Truena al construir:
  // es preferible a publicar un titular con un «*» suelto.
  if (pieces.length % 2 === 0) throw new Error(`Énfasis sin cerrar en: «${text}»`);
  return pieces
    .map((piece, index) => ({ text: piece, emphasis: index % 2 === 1 }))
    .filter((part) => part.text !== "");
}
