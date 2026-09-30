import { createConfirmer, isInsideArea, visibleArea } from "./visible-area";

/**
 * Carlos, 2026-09-29: el escáner leía códigos que NO se veían en el recuadro
 * (uno debajo de la franja se leyó bien) y, con el código a la vista, entregaba
 * lecturas válidas pero equivocadas. El video usa `object-cover`: una cámara
 * vertical de 1080×1920 en una franja ancha muestra solo el tercio central de
 * la foto, y el detector nativo recibe la foto COMPLETA.
 */
describe("visibleArea: qué parte de la foto muestra el recuadro", () => {
  it("cámara vertical en una franja ancha: solo el tercio central", () => {
    // 360×192 en pantalla; la escala la fija el ancho (360/1080 = 1/3).
    expect(
      visibleArea({ videoWidth: 1080, videoHeight: 1920, clientWidth: 360, clientHeight: 192 }),
    ).toEqual({ x: 0, y: 672, width: 1080, height: 576 });
  });

  it("cámara horizontal en la misma franja: casi toda la foto", () => {
    // La escala la fija el ancho (360/1920 = 0.1875) y sobra un poco de alto.
    expect(
      visibleArea({ videoWidth: 1920, videoHeight: 1080, clientWidth: 360, clientHeight: 192 }),
    ).toEqual({ x: 0, y: 28, width: 1920, height: 1024 });
  });

  it("antes de que el video tenga medidas no hay área: no se filtra nada", () => {
    expect(
      visibleArea({ videoWidth: 0, videoHeight: 0, clientWidth: 360, clientHeight: 192 }),
    ).toBeNull();
    expect(
      visibleArea({ videoWidth: 1080, videoHeight: 1920, clientWidth: 0, clientHeight: 0 }),
    ).toBeNull();
  });
});

describe("isInsideArea: el código cuenta si su centro está a la vista", () => {
  const area = { x: 0, y: 672, width: 1080, height: 576 };

  it("un código en la franja visible cuenta", () => {
    expect(isInsideArea({ x: 300, y: 900, width: 480, height: 160 }, area)).toBe(true);
  });

  it("un código debajo de la franja NO cuenta, aunque esté en la foto", () => {
    expect(isInsideArea({ x: 300, y: 1500, width: 480, height: 160 }, area)).toBe(false);
  });

  it("un código encima de la franja tampoco", () => {
    expect(isInsideArea({ x: 300, y: 200, width: 480, height: 160 }, area)).toBe(false);
  });

  it("sin área o sin caja del código no hay con qué filtrar: cuenta", () => {
    expect(isInsideArea({ x: 300, y: 1500, width: 480, height: 160 }, null)).toBe(true);
    expect(isInsideArea(undefined, area)).toBe(true);
  });
});

describe("createConfirmer: un código cuenta si se lee igual dos veces en la ventana", () => {
  it("la primera lectura no basta; la segunda igual, sí", () => {
    const confirm = createConfirmer(500);
    expect(confirm("721733000968", 0)).toBe(false);
    expect(confirm("721733000968", 100)).toBe(true);
  });

  it("una lectura borrosa distinta en medio NO reinicia la cuenta", () => {
    // Carlos, 2026-09-29, en su Android: con «dos seguidas» un cuadro fallido
    // en medio obligaba a sostener el producto quieto y a la distancia exacta.
    const confirm = createConfirmer(500);
    expect(confirm("721733000968", 0)).toBe(false);
    expect(confirm("721733000937", 100)).toBe(false);
    expect(confirm("721733000968", 200)).toBe(true);
  });

  it("la lectura borrosa no junta votos con la buena", () => {
    const confirm = createConfirmer(500);
    expect(confirm("721733000968", 0)).toBe(false);
    expect(confirm("721733000937", 100)).toBe(false);
    expect(confirm("721966444003", 200)).toBe(false);
  });

  it("la misma lectura, pero ya fuera de la ventana, no confirma", () => {
    const confirm = createConfirmer(500);
    expect(confirm("721733000968", 0)).toBe(false);
    expect(confirm("721733000968", 900)).toBe(false);
    expect(confirm("721733000968", 1000)).toBe(true);
  });
});
