export interface AuthUser {
  userId: string;
  tenantId: string;
  permissions: string[];
  locale: "es" | "en";
}
