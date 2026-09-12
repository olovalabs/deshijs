declare module 'acorn-jsx' {
  import type { Parser } from 'acorn';
  interface JsxOptions {
    allowNamespaces?: boolean;
    allowNamespacedObjects?: boolean;
  }
  export default function jsx(options?: JsxOptions): (BaseParser: typeof Parser) => typeof Parser;
}
