/**
 * Términos y Condiciones base de Doorway Cortex Bio-Pass.
 * Servido en GET /api/legal/terminos (HTML) y enlazado por el bot en el registro.
 * BORRADOR — revisar con asesoría legal antes de considerarlo definitivo.
 */
export const TERMS_VERSION = '2026-09-09';

export const TERMS_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Términos y Condiciones — Doorway Cortex Bio-Pass</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f6f7f9; color:#1a1a1a; }
  @media (prefers-color-scheme: dark){ body{ background:#0f1115; color:#e6e6e6; } .card{ background:#171a21 !important; border-color:#2a2f3a !important; } }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:16px; padding:28px 26px; }
  h1 { font-size: 1.5rem; margin:.2em 0 .1em; }
  h2 { font-size: 1.05rem; margin:1.6em 0 .4em; }
  .muted { color:#6b7280; font-size:.85rem; }
  ul { padding-left: 1.2em; }
  li { margin:.3em 0; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Términos y Condiciones de Uso</h1>
      <p class="muted">Doorway Cortex Bio-Pass — Pasaporte Médico de Emergencia · Versión ${TERMS_VERSION} · Paraguay / Brasil</p>

      <h2>1. Objeto del servicio</h2>
      <p>Bio-Pass es un servicio digital que permite al usuario registrar datos médicos de emergencia,
      generar un código QR de rescate y almacenar estudios clínicos cifrados. <strong>No sustituye
      la atención médica profesional</strong> ni constituye un diagnóstico.</p>

      <h2>2. Identidad y cuenta</h2>
      <ul>
        <li>El usuario se identifica por su número de celular, validado por WhatsApp / código OTP.</li>
        <li>El PIN de 4 dígitos es la llave privada del usuario. Ni el equipo ni los administradores
        pueden ver el historial cifrado sin ese PIN.</li>
        <li>La Clave de Recuperación de 16 caracteres es el único medio de recuperar el acceso si se
        olvida el PIN. El usuario es responsable de guardarla. Su pérdida puede implicar la pérdida
        definitiva del acceso al historial cifrado.</li>
      </ul>

      <h2>3. Datos personales y de salud</h2>
      <ul>
        <li>El usuario autoriza el tratamiento de sus datos personales y de salud con la finalidad de
        prestar el servicio (Ley N° 6534/2020 de Paraguay; LGPD - Lei 13.709/2018 de Brasil; y
        estándares GDPR).</li>
        <li>Los datos de la ficha de emergencia (nombre, RH, alergias, condiciones, contacto) son
        visibles para cualquier persona que escanee el QR, por su naturaleza de rescate.</li>
        <li>Los estudios y el historial de consultas se almacenan cifrados y solo son legibles con el PIN.</li>
        <li>El usuario puede descargar todo su historial en cualquier momento (portabilidad de datos).</li>
      </ul>

      <h2>4. Suscripción, pagos y vencimiento</h2>
      <ul>
        <li>El servicio se activa con el pago del plan (mensual o anual). Hasta que el pago no se
        confirme, el QR no se genera.</li>
        <li>Avisos de vencimiento: 5 días antes, el día del vencimiento y 3 días después.</li>
        <li>A los 4 días de mora la cuenta se marca como <strong>cancelada</strong> y los datos se
        bloquean. Se puede reactivar dentro de 30 días abonando la cuota más una multa
        (Gs. 50.000 / R$ 44).</li>
        <li>A los 30 días de la cancelación sin regularizar, <strong>todos los datos se eliminan
        físicamente</strong> de forma irreversible, en cumplimiento de GDPR/LGPD.</li>
      </ul>

      <h2>5. Uso correcto</h2>
      <p>El usuario declara que los datos cargados son veraces y propios. Está prohibido cargar datos
      de terceros sin su consentimiento o contenido ilícito.</p>

      <h2>6. Limitación de responsabilidad</h2>
      <p>El servicio se presta "tal cual". Bio-Pass no garantiza disponibilidad ininterrumpida y no
      se responsabiliza por decisiones médicas tomadas a partir de la información mostrada, ni por
      datos inexactos cargados por el usuario.</p>

      <h2>7. Contacto</h2>
      <p>Consultas y ejercicio de derechos sobre datos personales: soporte@bio-pass.com</p>

      <p class="muted" style="margin-top:2em">Al continuar el registro y responder "ACEPTO", el
      usuario declara haber leído y aceptado estos Términos y Condiciones y la Política de
      Privacidad asociada.</p>
    </div>
  </div>
</body>
</html>`;
