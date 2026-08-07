export interface JwtPayload {
  sub: string;
  tenantId: string;
  permissions: string[];
  locale: "es" | "en";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export type AccessTokenClaims = Pick<JwtPayload, "sub" | "tenantId" | "permissions" | "locale">;
