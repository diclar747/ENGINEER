// PIN "recordado" solo para esta pestaña/app: sessionStorage, nunca localStorage.
// A diferencia de una variable en memoria (que se pierde con CUALQUIER recarga —
// muy común en un PWA de celular, que el sistema operativo descarga y recarga al
// volver de segundo plano), sessionStorage sobrevive recargas dentro de la misma
// sesión de navegación y solo se borra al cerrar de verdad la pestaña/app.
const KEY = 'biopass_pin_session';

export function setSessionPin(pin: string): void {
  try {
    sessionStorage.setItem(KEY, pin);
  } catch {
    /* Safari privado / storage bloqueado: no hay caché, se repregunta y ya. */
  }
}

export function getSessionPin(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearSessionPin(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
