/**
 * Recursively sanitizes data to ensure it is 100% compliant with Cloud Firestore.
 * 
 * Rules enforced:
 * 1. Cloud Firestore rejects nested arrays: "Nested arrays are not supported".
 *    Any array element that is itself an array (e.g. `[lat, lng]` coordinates in polygonVertices)
 *    is converted into a supported object: `{ lat: item[0], lng: item[1] }`.
 * 2. Strips undefined properties (Firestore throws if any property is undefined).
 * 3. Preserves Firestore FieldValues (like serverTimestamp()) and Date instances.
 */
export function sanitizeForFirestore(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'object') return val;

  // Preserve Date instances and Firestore FieldValues / Sentinels
  if (val instanceof Date || val._methodName || val.constructor?.name === 'FieldValue') {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => {
      if (Array.isArray(item)) {
        // Nested array detected! Convert to Firestore-compatible object
        if (item.length === 2 && typeof item[0] === 'number' && typeof item[1] === 'number') {
          return { lat: item[0], lng: item[1] };
        }
        const obj = {};
        item.forEach((sub, idx) => {
          obj[`item_${idx}`] = sanitizeForFirestore(sub);
        });
        return obj;
      }
      return sanitizeForFirestore(item);
    });
  }

  // Plain object
  const cleanObj = {};
  for (const [k, v] of Object.entries(val)) {
    if (v === undefined) continue;
    cleanObj[k] = sanitizeForFirestore(v);
  }
  return cleanObj;
}
