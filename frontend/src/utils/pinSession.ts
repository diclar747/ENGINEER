// PIN "recordado" solo en memoria de la pestaña (nunca en localStorage/sessionStorage).
// Se pierde al recargar la página o cerrar sesión — el modelo Zero-Knowledge se
// mantiene entre visitas, pero no obliga a re-tipear el PIN en cada descarga
// dentro de la misma sesión de navegación.
let cachedPin: string | null = null;

export function setSessionPin(pin: string): void {
  cachedPin = pin;
}

export function getSessionPin(): string | null {
  return cachedPin;
}

export function clearSessionPin(): void {
  cachedPin = null;
}
