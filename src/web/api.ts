export function buildRequestInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return {...init, headers};
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, buildRequestInit(init));
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

