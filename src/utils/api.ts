function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export async function mutlyFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const cookieKey = getCookie("mutly_session_token");
  const envKey = ((import.meta as any).env?.VITE_MUTLY_API_KEY as string);
  let activeKey = cookieKey || envKey || "dev_mutly_secure_master_key";

  if (!cookieKey && !envKey && typeof window !== "undefined") {
    try {
      const cfgRes = await fetch("/api/agent/public-config");
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg.devApiKeyHint) activeKey = cfg.devApiKeyHint;
      }
    } catch {
      // use dev default
    }
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Mutly-API-Key": activeKey,
    ...options.headers,
  } as Record<string, string>;

  return fetch(url, {
    ...options,
    headers,
  });
}
