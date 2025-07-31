// types/deno.d.ts
declare global {
    namespace Deno {
      interface Env {
        get(key: string): string | undefined;
      }
      
      export const env: Env;
    }
  }
  
  export {};