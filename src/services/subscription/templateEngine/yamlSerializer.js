/**
 * Minimal YAML serialiser (Clash Meta-compatible subset).
 *
 * Supports: string, number, boolean, null, plain array, plain object.
 * Strings that need quoting are double-quoted; everything else is unquoted.
 */

const NEEDS_QUOTE = /[:#\[\]{},&*?|<>=!%@`\n\r\t]|^[\s-]|[\s]$/; // eslint-disable-line no-useless-escape

function yamlStr(v) {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  if (s === '') return "''";
  if (NEEDS_QUOTE.test(s) || s === 'true' || s === 'false' || s === 'null' || /^\d/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function _serialize(obj, indent = 0) {
  const pad = '  '.repeat(indent);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]\n';
    return obj
      .map((item) => {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const entries = Object.entries(item);
          const first = entries[0];
          const rest = entries.slice(1);
          let out = `${pad}- ${first[0]}: ${yamlValue(first[1], indent + 1).trimEnd()}\n`;
          for (const [k, v] of rest) {
            out += `${pad}  ${k}: ${yamlValue(v, indent + 1).trimEnd()}\n`;
          }
          return out;
        }
        return `${pad}- ${yamlValue(item, indent + 1).trimEnd()}\n`;
      })
      .join('');
  }

  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj)
      .map(([k, v]) => `${pad}${k}: ${yamlValue(v, indent + 1).trimEnd()}\n`)
      .join('');
  }

  return yamlValue(obj, indent);
}

function yamlValue(v, indent) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return yamlStr(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((i) => typeof i !== 'object' || i === null)) {
      return '[' + v.map((i) => yamlStr(String(i))).join(', ') + ']';
    }
    return '\n' + _serialize(v, indent);
  }
  if (typeof v === 'object') {
    return '\n' + _serialize(v, indent);
  }
  return String(v);
}

export function serializeYaml(doc) {
  return _serialize(doc, 0);
}
