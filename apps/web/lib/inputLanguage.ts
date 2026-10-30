// What: Cheap bilingual-input heuristic used for the `item_added.input_language` property
// Why: The edge function uses the same heuristic to decide when to invoke
//      Claude NLP normalization. Mirroring it client-side keeps our analytics
//      attribution (`'es'` vs `'en'`) consistent with the server's decision.
// Does NOT: Detect other languages, run statistical models, or replace proper
//           language detection. Cheap regex + fit-for-purpose for v0.

/**
 * True when `text` looks like English input (no known Spanish indicator
 * words). Mirrors the server-side check in
 * `supabase/functions/add-item/index.ts`. When in doubt it returns `true`
 * (i.e. "English") — the downstream behavior (skipping NLP normalization,
 * or labeling the telemetry `'en'`) fails safely in that direction.
 */
export function isLikelyEnglish(text: string): boolean {
  const spanishWords =
    /\b(agrega|agregar|añade|añadir|leche|queso|manzana|pollo|carne|pan|huevos|arroz|frijoles|tomate|cebolla|ajo|aguacate|limón|naranja|platano|fresa)\b/i;
  return !spanishWords.test(text);
}

export type InputLanguage = 'en' | 'es';

/** Coarse language label for the `item_added.input_language` event property. */
export function detectInputLanguage(text: string): InputLanguage {
  return isLikelyEnglish(text) ? 'en' : 'es';
}
