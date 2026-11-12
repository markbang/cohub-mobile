export interface KaTeXInstance {
  renderToString(
    expression: string,
    options?: {
      displayMode?: boolean;
      throwOnError?: boolean;
      trust?: boolean;
      output?: 'html' | 'mathml' | 'htmlAndMathml';
    }
  ): string;
}


/** cohub: the app ships no KaTeX, so the web renderer shows math as source. */
export function loadKaTeX(): Promise<KaTeXInstance | null> {
  return Promise.resolve(null);
}
