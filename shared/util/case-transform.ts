/**
 * Converts a snake_case string to camelCase.
 * @example snakeToCamel('item_id') => 'itemId'
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Recursively transforms all object keys from snake_case to camelCase.
 * Handles nested objects and arrays.
 */
export function transformKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(transformKeys);
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.keys(obj).reduce((acc, key) => {
      acc[snakeToCamel(key)] = transformKeys(obj[key]);
      return acc;
    }, {} as any);
  }
  return obj;
}
