/**
 * Genera los iconos de la marca a partir de los SVG de `src/assets/brand/`.
 *
 *   pnpm --filter site exec node scripts/render-brand.mjs
 *
 * Los SVG son la ÚNICA fuente: los PNG de `apps/site/public/` y de
 * `apps/web/public/` se rehacen desde aquí, así que nadie tiene que retocar un
 * bitmap a mano cuando la marca cambie. Los originales de la marca viven en
 * `apps/web/public/brand/` y este script NO los toca.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONOREPO = join(RAIZ, "../..");
const MARCA = join(RAIZ, "src/assets/brand");
const SITE_PUBLIC = join(RAIZ, "public");
const WEB_PUBLIC = join(RAIZ, "../web/public");

const AZUL = "#1E3FD8";

/**
 * La caja del contenido (S + punto) dentro del viewBox de 512, medida sobre el
 * original en `apps/web/public/brand/icon-source.png`. Es un dato, no un
 * cálculo: medir un path pide un motor SVG, y no vale la pena traer uno solo
 * para esto. Si el logo cambia de forma, se vuelve a medir.
 */
const CONTENIDO = { x: 106.27, y: 116.52, ancho: 323.59, alto: 272.85 };

/** Factor de la zona segura de un icono `maskable`: el 80 % central. */
const ZONA_SEGURA = 0.8;

/**
 * Icono de fondo azul a sangre con el contenido CENTRADO: sirve para el
 * `maskable` de Android y para el de iOS, que también recorta.
 *
 * Aquí el círculo no se dibuja —el fondo entero ya es azul— así que la S deja
 * de estar encuadrada por él y hay que recentrarla: en el logo la composición
 * es deliberadamente descentrada (el punto empuja a la derecha), y sin círculo
 * eso se leería como un error de alineación.
 */
function svgSobreAzul(sPath, punto) {
  const cx = CONTENIDO.x + CONTENIDO.ancho / 2;
  const cy = CONTENIDO.y + CONTENIDO.alto / 2;
  // Se escala por la DIAGONAL de la caja: la zona segura es un círculo, y el
  // punto del contenido más lejos del centro es una esquina, no un lado.
  const radio = Math.hypot(CONTENIDO.ancho / 2, CONTENIDO.alto / 2);
  const k = (256 * ZONA_SEGURA) / radio;
  const tx = 256 - k * cx;
  const ty = 256 - k * cy;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
      `<rect width="512" height="512" fill="${AZUL}"/>` +
      `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(5)})">` +
      `<path fill="#FFFFFF" d="${sPath}"/>` +
      `<circle cx="${punto.cx}" cy="${punto.cy}" r="${punto.r}" fill="#FFC42E"/>` +
      `</g></svg>`,
  );
}

/**
 * Rasteriza al cuádruple y baja con Lanczos: el rasterizador redondea las
 * curvas al pixel, y un 32×32 pedido de golpe sale dentado.
 *
 * Son DOS pipelines de sharp a propósito: encadenar dos `resize()` en uno solo
 * no compone, el segundo pisa al primero.
 */
async function aPng(svg, tam, { opaco = false } = {}) {
  const grande = Math.min(tam * 4, 2048);
  // Los SVG declaran 512×512, así que la densidad fija el tamaño del rasterizado.
  const crudo = await sharp(svg, { density: (72 * grande) / 512 })
    .png()
    .toBuffer();
  const bajado = sharp(crudo).resize(tam, tam, { kernel: "lanczos3" });
  return (opaco ? bajado.flatten({ background: AZUL }) : bajado.ensureAlpha())
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function escribir(destino, buffer) {
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, buffer);
  return relative(MONOREPO, destino);
}

const logo = await readFile(join(MARCA, "logo.svg"));
const invertido = await readFile(join(MARCA, "logo-inverted.svg"));

const texto = logo.toString();
const sPath = /<path[^>]*\sd="([^"]+)"/.exec(texto)?.[1];
const punto = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#FFC42E"/.exec(texto);
if (sPath === undefined || punto === null) {
  throw new Error("logo.svg no trae el path de la S y el círculo amarillo del punto");
}
const sobreAzul = svgSobreAzul(sPath, { cx: punto[1], cy: punto[2], r: punto[3] });

// El SVG es el favicon preferido: el navegador lo escala sin perder filo y no
// hay que servir un PNG por densidad de pantalla. Los PNG quedan de respaldo.
await mkdir(SITE_PUBLIC, { recursive: true });
const hechos = [];
for (const destino of [join(SITE_PUBLIC, "favicon.svg"), join(WEB_PUBLIC, "favicon.svg")]) {
  await copyFile(join(MARCA, "logo.svg"), destino);
  hechos.push(relative(MONOREPO, destino));
}

const comunes = [
  ["favicon-32.png", logo, 32, {}],
  ["favicon-192.png", logo, 192, {}],
  ["favicon-512.png", logo, 512, {}],
  // iOS NO respeta la transparencia: rellena las esquinas de negro y recorta
  // el icono con su propia máscara redondeada. Por eso va opaco y a sangre.
  ["apple-touch-icon.png", sobreAzul, 180, { opaco: true }],
  ["icon-maskable-512.png", sobreAzul, 512, { opaco: true }],
];

for (const [nombre, fuente, tam, opts] of comunes) {
  const png = await aPng(fuente, tam, opts);
  hechos.push(await escribir(join(SITE_PUBLIC, nombre), png));
  hechos.push(await escribir(join(WEB_PUBLIC, nombre), png));
}

// El logotipo del sidebar del web: dos archivos porque `dark:` elige cuál se
// ve. Sobre el sidebar oscuro (#25272c) el azul del círculo no llega a 2:1 de
// contraste, así que ahí va la versión invertida, de círculo blanco.
hechos.push(await escribir(join(WEB_PUBLIC, "logo-light.png"), await aPng(logo, 128)));
hechos.push(await escribir(join(WEB_PUBLIC, "logo-dark.png"), await aPng(invertido, 128)));

for (const ruta of hechos) {
  console.log(ruta);
}
