/**
 * Utility to generate and validate RFC4122 v4 UUIDs
 * Compatible with PostgreSQL UUID columns in Supabase and local storage
 */
export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fallback if randomUUID fails
    }
  }

  // RFC4122 version 4 compliant fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const isValidUUID = (str: string | null | undefined): boolean => {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
};

export const ensureUUID = (str: string | null | undefined): string => {
  if (isValidUUID(str)) {
    return (str as string).trim();
  }
  return generateUUID();
};

export const sanitizeUUIDOrNull = (str: string | null | undefined): string | null => {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  return isValidUUID(trimmed) ? trimmed : null;
};
