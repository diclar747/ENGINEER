import { api } from './api';

export type PushState =
  | 'unsupported'
  | 'server-disabled'
  | 'default'
  | 'denied'
  | 'subscribed'
  | 'error';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/** Current state without prompting the user. */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  try {
    const { data } = await api.get('/push/vapid-public-key');
    if (!data?.enabled || !data?.publicKey) return 'server-disabled';
  } catch {
    return 'error';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const existing = reg ? await reg.pushManager.getSubscription() : null;
  if (existing) return 'subscribed';
  return 'default';
}

/**
 * Prompts for permission (if needed), subscribes, and registers with the backend.
 * Attaches to the logged-in user automatically when an auth token is present, or —
 * for members who only ever registered by WhatsApp and have no web session — via an
 * `emergencyToken` (the id in the `/push/:emergencyToken` link the bot sends).
 */
export async function subscribeToPush(emergencyToken?: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const { data: vapid } = await api.get('/push/vapid-public-key');
  if (!vapid?.enabled || !vapid?.publicKey) return 'server-disabled';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  if (!reg) return 'error';

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
    });
  }

  await api.post('/push/subscribe', { subscription: sub.toJSON(), emergencyToken });
  return 'subscribed';
}

/**
 * Llamar justo después de un login o registro exitoso. Si el navegador YA
 * tiene el permiso concedido (p. ej. lo aceptó en el PushPrompt de /login antes
 * de tener cuenta, quedando una suscripción anónima), re-suscribe con el token
 * de auth ya en el header — el backend hace upsert por endpoint y la liga a
 * este usuario. Si el permiso todavía no se decidió o está bloqueado, NO
 * vuelve a pedirlo acá (ya se le preguntó, o dijo que no) — nunca lanza.
 */
export async function rebindPushIfGranted(emergencyToken?: string): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    await subscribeToPush(emergencyToken);
  } catch {
    /* best-effort */
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function sendTestPush(): Promise<{ sent: number; pruned: number }> {
  const { data } = await api.post('/push/test', {});
  return { sent: data?.sent ?? 0, pruned: data?.pruned ?? 0 };
}
