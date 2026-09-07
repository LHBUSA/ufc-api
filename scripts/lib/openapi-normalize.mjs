/* Repair a YAML flow-map authoring artifact present in the upstream OpenAPI file:
 *   { description: Editorial betting relevance (1 low, 5 high). Analysis, not a price. }
 * parses as description: "…(1 low" plus junk keys "5 high). Analysis" and "not a price." with null values.
 * We fold those null-valued junk keys back into the description, in order. Nothing else is touched. */
const OAS_KEYS = new Set(["type", "format", "enum", "items", "properties", "required", "additionalProperties", "unevaluatedProperties", "description", "example", "examples", "default", "nullable", "minimum", "maximum", "minLength", "maxLength", "pattern", "oneOf", "anyOf", "allOf", "not", "$ref", "title", "const", "deprecated", "readOnly", "writeOnly", "minItems", "maxItems", "uniqueItems", "name", "in", "schema", "content", "headers", "summary", "operationId", "parameters", "responses", "tags", "security", "servers", "style", "explode", "allowReserved", "x-plan", "x-feature", "x-origin", "x-plans"]);

export function normalizeOpenApi(node) {
  if (Array.isArray(node)) { node.forEach(normalizeOpenApi); return node; }
  if (!node || typeof node !== "object") return node;
  if (typeof node.description === "string") {
    const junk = Object.keys(node).filter((k) => node[k] === null && !OAS_KEYS.has(k));
    if (junk.length) {
      node.description = [node.description, ...junk].join(", ").replace(/,\s*,/g, ",").trim();
      for (const k of junk) delete node[k];
    }
  }
  for (const v of Object.values(node)) normalizeOpenApi(v);
  return node;
}
