import crypto from "crypto";

const DEV_DEFAULT_KEY = "dev_mutly_secure_master_key";

export function resolveMutlyApiKey(storedKey?: string): string {
  if (process.env.MUTLY_API_KEY) {
    return process.env.MUTLY_API_KEY;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MUTLY_API_KEY is required in production");
  }
  if (storedKey) {
    return storedKey;
  }
  return DEV_DEFAULT_KEY;
}

export function validateMutlyApiKey(
  presented: string | undefined,
  expected: string
): boolean {
  if (!presented || !expected) return false;
  try {
    const a = crypto.createHash("sha256").update(presented).digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function extractApiKeyFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const direct = headers["x-mutly-api-key"];
  if (typeof direct === "string" && direct) return direct;
  const auth = headers["authorization"];
  const authStr = Array.isArray(auth) ? auth[0] : auth;
  if (authStr?.toLowerCase().startsWith("bearer ")) {
    return authStr.slice(7).trim();
  }
  return undefined;
}
