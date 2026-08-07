export const HASHER = Symbol("HASHER");

export interface HashPort {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}
