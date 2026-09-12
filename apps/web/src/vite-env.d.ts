/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base del API de SellPoint (sin slash final) */
  readonly VITE_API_URL: string;
  /** F6-RELEASE-04: versión del package.json raíz y sha corto, bakeados en el build. */
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
