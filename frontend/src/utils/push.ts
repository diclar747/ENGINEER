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
 * Attaches to the logged-in user automatically when a token is present.
 */
export async function subscribeToPush(): Promise<PushState> {
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

  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return 'subscribed';
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
