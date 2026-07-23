/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base del API de SellPoint (sin slash final) */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
