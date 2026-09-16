/** Correo de soporte que se muestra en toda la app (mismo que usa el bot de WhatsApp). */
export const SUPPORT_EMAIL = 'doorway.cortex.bio.pass@cardnet-ltda.com';

export const supportMailto = (subject = 'Consulta Bio-Pass') =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
