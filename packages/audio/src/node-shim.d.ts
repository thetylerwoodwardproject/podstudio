// Just what dfn-node.ts uses, so this package type-checks on its own without @types/node.
declare module "node:fs/promises" {
  export function readFile(path: string): Promise<Uint8Array>;
}
declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
}
