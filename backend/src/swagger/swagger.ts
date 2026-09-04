import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Doorway Cortex Bio-Pass API',
    version: '1.0.0',
    description: 'API REST para Mobile Health Passport, WhatsApp Bot (Baileys), Zero-Knowledge Vault, Kits Físicos 3x3cm y Pagos Paraguay/Brasil.',
    contact: {
      name: 'Doorway Cortex Engineering Team',
      email: 'soporte@bio-pass.com',
    },
  },
  servers: [
    {
      url: 'http://localhost:4000/api',
      description: 'Local Development Server',
    },
  ],
  paths: {
    '/auth/request-otp': {
      post: {
        summary: 'Solicitar código OTP para inicio de sesión',
        tags: ['Autenticación'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  phoneNumber: { type: 'string', example: '595981123456' },
                },
                required: ['phoneNumber'],
              },
            },
          },
        },
        responses: {
          200: { description: 'OTP enviado con éxito' },
        },
      },
    },
    '/auth/verify-login': {
      post: {
        summary: 'Verificar OTP + PIN y obtener Token JWT',
        tags: ['Autenticación'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  phoneNumber: { type: 'string', example: '595981123456' },
                  otp: { type: 'string', example: '123456' },
                  pin: { type: 'string', example: '8492' },
                },
                required: ['phoneNumber', 'otp'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Sesión iniciada correctamente' },
          401: { description: 'PIN o código incorrecto' },
        },
      },
    },
    '/emergency/{token}': {
      get: {
        summary: 'Modo Emergencia Público (Sin PIN) - Escaneo de QR',
        description: 'Retorna foto, RH, alertas visuales y contacto. Dispara notificación push por WhatsApp con geolocalización IP al titular.',
        tags: ['Emergencia & Rescate'],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Datos de emergencia para brigadistas y paramédicos' },
          404: { description: 'Código Bio-Pass no encontrado' },
        },
      },
    },
    '/emergency/{token}/consultation': {
      post: {
        summary: 'Modo Consulta Médica Privada (Con PIN de 4 dígitos)',
        description: 'Valida el PIN y permite descifrar el historial clínico unificado y estudios en la nube.',
        tags: ['Emergencia & Rescate'],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pin: { type: 'string', example: '8492' },
                },
                required: ['pin'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Historial médico y lista de estudios descargables' },
          401: { description: 'PIN incorrecto' },
        },
      },
    },
    '/emergency/{token}/call-contact': {
      post: {
        summary: 'Botón Rojo: Llamar a Familiar de Emergencia',
        description: 'Dispara una llamada de voz automática al contacto de emergencia.',
        tags: ['Emergencia & Rescate'],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Llamada iniciada con éxito' },
        },
      },
    },
    '/stickers/{token}/pdf': {
      get: {
        summary: 'Descargar PDF del Kit Físico (3x3 cm + Sangrado + Co-Branding)',
        tags: ['Kit Físico & QR'],
        parameters: [
          { name: 'token', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Archivo PDF listo para imprimir en vinilo adhesivo' },
        },
      },
    },
    '/export/full-vault': {
      post: {
        summary: 'Descargar Historial Completo (ZIP Cifrado con PIN)',
        description: 'Genera archivo ZIP con contraseña (PIN) con validez de 24 horas.',
        tags: ['Portabilidad de Datos'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pin: { type: 'string', example: '8492' },
                },
                required: ['pin'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Enlace firmado de descarga con expiración de 24h' },
        },
      },
    },
    '/payments/create-order': {
      post: {
        summary: 'Crear Orden de Pago (Paraguay: Alias/Tigo / Brasil: PIX)',
        tags: ['Pagos & Suscripciones'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  userId: { type: 'string' },
                  plan: { type: 'string', enum: ['MONTHLY', 'ANNUAL'] },
                  country: { type: 'string', enum: ['PARAGUAY', 'BRASIL'] },
                  isFine: { type: 'boolean' },
                },
                required: ['userId', 'plan', 'country'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Detalles de pago con Alias o copia-pega PIX' },
        },
      },
    },
    '/bot/simulate-message': {
      post: {
        summary: 'Simulador Conversacional de Bot WhatsApp (Baileys)',
        description: 'Prueba el onboarding y comandos NLP sin requerir WhatsApp físico.',
        tags: ['WhatsApp Bot Engine'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  from: { type: 'string', example: '595981123456' },
                  body: { type: 'string', example: 'Hola' },
                },
                required: ['from', 'body'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Respuesta generada por la máquina de estados' },
        },
      },
    },
    '/bot/status': {
      get: {
        summary: 'Estado del motor Baileys + QR de vinculación',
        description: 'Devuelve connected, connecting, qrCode (data URL), reconnectAttempts y gaveUp. El QR se consume en la pantalla /bot-connect.',
        tags: ['WhatsApp Bot Engine'],
        responses: { 200: { description: 'Estado actual del bot' } },
      },
    },
    '/bot/reconnect': {
      post: {
        summary: 'Forzar un nuevo intento de vinculación',
        description: 'Reinicia el contador de reconexión y genera un QR nuevo si el cliente se había rendido.',
        tags: ['WhatsApp Bot Engine'],
        responses: { 200: { description: 'Reintento disparado' } },
      },
    },
    '/push/vapid-public-key': {
      get: {
        summary: 'Clave pública VAPID para Web Push',
        description: 'El navegador la necesita para construir la suscripción push. { enabled, publicKey }.',
        tags: ['Notificaciones Push'],
        responses: { 200: { description: 'Clave pública (o enabled:false si no está configurado)' } },
      },
    },
    '/push/subscribe': {
      post: {
        summary: 'Registrar una suscripción push del navegador',
        description: 'Funciona anónimo o, con Authorization Bearer, queda ligada al usuario. Cada escaneo de emergencia dispara una notificación a estas suscripciones.',
        tags: ['Notificaciones Push'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  subscription: {
                    type: 'object',
                    description: 'PushSubscription.toJSON() del navegador',
                    properties: {
                      endpoint: { type: 'string' },
                      keys: {
                        type: 'object',
                        properties: { p256dh: { type: 'string' }, auth: { type: 'string' } },
                      },
                    },
                  },
                },
                required: ['subscription'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Suscripción guardada { success, bound }' },
          503: { description: 'Web Push no configurado (faltan claves VAPID)' },
        },
      },
    },
    '/push/unsubscribe': {
      post: {
        summary: 'Eliminar una suscripción push',
        tags: ['Notificaciones Push'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { endpoint: { type: 'string' } }, required: ['endpoint'] },
            },
          },
        },
        responses: { 200: { description: 'Eliminada' } },
      },
    },
    '/push/test': {
      post: {
        summary: 'Enviar una notificación de prueba al usuario autenticado',
        tags: ['Notificaciones Push'],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: '{ success, sent, pruned }' } },
      },
    },
  },
};

export function setupSwagger(app: Express): void {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log('📖 Swagger API Documentation initialized at: /api/docs');
}
