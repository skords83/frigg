import { DavError } from './davSafety';

// Closed vocabulary only: never include input, property names, positions or values.
export const vcardStructureCategories = [
  'non_string_input', 'nul_character', 'bare_cr', 'orphan_fold',
  // Retained for compatibility with historical diagnostic events; no longer emitted.
  'empty_line', 'empty_property_name', 'unclosed_header_quote', 'missing_separator',
  'leading_bom', 'multiple_group_separators', 'invalid_group_name', 'invalid_property_name',
  'missing_begin', 'invalid_begin_value', 'missing_end', 'invalid_end_value', 'boundary_count',
] as const;
export type VCardStructureCategory = typeof vcardStructureCategories[number];

/** Same public status/code/message as before; only adds safe diagnostic metadata. */
export class VCardStructureError extends DavError {
  constructor(readonly subcategory: VCardStructureCategory) {
    super(422, 'invalid_vcard');
  }
}
export function safeStructureCategory(value: unknown): VCardStructureCategory | undefined {
  return typeof value === 'string' && (vcardStructureCategories as readonly string[]).includes(value)
    ? value as VCardStructureCategory : undefined;
}
