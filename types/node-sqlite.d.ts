declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all: (...params: unknown[]) => any[];
      get: (...params: unknown[]) => any;
      run: (...params: unknown[]) => { changes?: number | bigint };
    };
  }
}
