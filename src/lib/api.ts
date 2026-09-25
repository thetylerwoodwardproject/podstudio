/* Calls to the Podstudio API (same origin). Errors come back with a message fit to show. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = Record<string, unknown>>(path: string, o: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      headers: o.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the Podstudio server. Check your connection.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error || `Error ${res.status}`);
  return data as T;
}

/** The code typed into an OtpInput group. */
export const otpValue = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('[data-otp] input')].map((i) => i.value).join('');

/** Where to go after signing in: a same-site ?next= path, or `fallback`. */
export function nextPath(fallback = '/') {
  const next = new URL(location.href).searchParams.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

/** Show an error under a form (a [data-error] element), or clear it. */
export function showError(form: ParentNode, message: string | null) {
  const el = form.querySelector<HTMLElement>('[data-error]');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message ?? '';
}
