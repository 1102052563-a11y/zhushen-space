/* sql.js 最小类型声明（包无自带 .d.ts）+ Vite `?url` 资源导入声明。仅覆盖 tableSqlite.ts 用到的 API。 */
declare module 'sql.js' {
  export interface SqlJsQueryResult { columns: string[]; values: unknown[][]; }
  export interface SqlJsDatabase {
    exec(sql: string): SqlJsQueryResult[];
    run(sql: string): void;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => SqlJsDatabase;
  }
  export interface SqlJsConfig { locateFile?: (file: string) => string; }
  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}

declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const url: string;
  export default url;
}
