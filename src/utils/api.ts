const MUTLY_API_KEY = ((import.meta as any).env?.VITE_MUTLY_API_KEY as string) || "dev_mutly_secure_master_key";

export async function mutlyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    "X-Mutly-API-Key": MUTLY_API_KEY,
    ...options.headers,
  };
  return fetch(url, {
    ...options,
    headers,
  });
}
