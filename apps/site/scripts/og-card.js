// La imagen para compartir en redes (1200 × 630), una por idioma.
//
// No es parte de la construcción: se corre A MANO cuando cambia el slogan o la
// marca. Se dibuja con el navegador —y no con una librería de imágenes— porque
// necesita las fuentes y los tokens DEL SITIO; así la tarjeta no puede verse
// distinta de la página.
//
// Receta:
//   1. `pnpm --filter site build && pnpm --filter site preview`
//   2. Abrir `/es-mx/`, `/en-us/` y `/fr-ca/` con la ventana en 1200 × 630.
//   3. En cada una, ejecutar esta función en la consola (o con Playwright) y
//      capturar la ventana a `public/og/es.png`, `en.png` y `fr.png`.
//
// Toma el titular que ya está en la página: no hay textos escritos aquí.
async function renderOgCard() {
  const headline = document.querySelector("h1");
  // El logo INVERTIDO (va sobre azul) sale del favicon, repintado con los
  // tokens: círculo blanco, «S» azul; el punto se queda amarillo.
  const svg = new DOMParser().parseFromString(
    await (await fetch("/favicon.svg")).text(),
    "image/svg+xml",
  ).documentElement;
  svg.setAttribute("width", "64");
  svg.setAttribute("height", "64");
  svg.querySelector("circle").style.fill = "var(--on-blue)";
  svg.querySelector("path").style.fill = "var(--blue)";
  const lines = [...headline.querySelectorAll(".line")].map((line) => line.textContent.trim());

  document.body.innerHTML = "";
  document.body.style.cssText =
    "margin:0;width:1200px;height:630px;overflow:hidden;position:relative;" +
    "background:var(--blue);color:var(--on-blue);font-family:var(--display)";

  const circle = document.createElement("div");
  circle.style.cssText =
    "position:absolute;right:-220px;top:-300px;width:900px;height:900px;" +
    "border-radius:50%;background:var(--blue-deep)";

  const brand = document.createElement("div");
  brand.style.cssText =
    "position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:18px;" +
    "font-weight:800;font-size:40px;letter-spacing:-.02em";
  brand.append(document.importNode(svg, true), "SellPointy");

  const title = document.createElement("div");
  title.style.cssText =
    "position:absolute;left:72px;right:72px;bottom:120px;font-weight:800;" +
    "font-size:112px;line-height:.94;letter-spacing:-.035em;text-wrap:balance";
  lines.forEach((text, index) => {
    const row = document.createElement("div");
    row.textContent = text;
    if (index === lines.length - 1) {
      const dot = document.createElement("span");
      dot.style.cssText =
        "display:inline-block;width:.6em;height:.6em;border-radius:50%;" +
        "background:var(--dot);margin-left:.06em";
      row.append(dot);
    }
    title.append(row);
  });

  const domain = document.createElement("div");
  domain.textContent = location.hostname === "127.0.0.1" ? "sellpointy.com" : location.hostname;
  domain.style.cssText =
    "position:absolute;left:72px;bottom:56px;font:500 28px var(--body);color:var(--on-blue-muted)";

  document.body.append(circle, brand, title, domain);
}

// Para pegarla en la consola o pasarla a `page.evaluate`.
globalThis.renderOgCard = renderOgCard;
