import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { SmtpEmailSender, smtpConfigFromEnv } from './smtp-email-sender';

/**
 * Verificación del adaptador SMTP contra un servidor REAL. Los tests unitarios cubren la lectura
 * de configuración; que el correo SALGA solo lo prueba un servidor que lo reciba.
 *
 * Se saltea si no hay uno configurado, para no atar la suite a Docker. Para correrla:
 *
 *   docker run -d --rm --name cw-mail -p 1025:1025 -p 8025:8025 axllent/mailpit
 *
 *   SMTP_TEST=http://localhost:8025 SMTP_HOST=localhost SMTP_PORT=1025 \
 *     SMTP_FROM='Cowinance <no-reply@cowinance.test>' \
 *     npx vitest run apps/api/src/infra/email
 */
const INBOX = process.env.SMTP_TEST;

describe.skipIf(!INBOX)('SmtpEmailSender contra un servidor real', () => {
  let sender: SmtpEmailSender;

  beforeAll(() => {
    sender = new SmtpEmailSender(smtpConfigFromEnv());
  });

  const buscar = async (asunto: string) => {
    const res = await fetch(`${INBOX}/api/v1/search?query=${encodeURIComponent(asunto)}`);
    const { messages } = (await res.json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    return messages;
  };

  it('conecta y valida las credenciales sin enviar nada', async () => {
    expect(await sender.verify()).toBe(true);
  });

  // El flujo que estaba roto en producción: sin un adaptador real, el link de reset se imprimía
  // al log y el usuario no recibía nada.
  it('entrega el email con destinatario, asunto y cuerpo intactos', async () => {
    const asunto = `Restablecer contraseña ${randomUUID().slice(0, 8)}`;
    const texto = 'Entrá en https://cowinance.test/reset-password?token=abc123 para elegir una nueva.';
    await sender.send({ to: 'productor@cowinance.test', subject: asunto, text: texto });

    const [mensaje] = await buscar(asunto);
    expect(mensaje, 'el mensaje no llegó al buzón').toBeDefined();
    expect(mensaje.To[0].Address).toBe('productor@cowinance.test');

    const detalle = await (await fetch(`${INBOX}/api/v1/message/${mensaje.ID}`)).json();
    expect((detalle as { Text: string }).Text.trim()).toBe(texto);
  });

  it('un host inexistente falla con error, no en silencio', async () => {
    const roto = new SmtpEmailSender({ ...smtpConfigFromEnv(), host: '127.0.0.1', port: 1 });
    await expect(roto.send({ to: 'x@y.test', subject: 'no sale', text: '.' })).rejects.toThrow();
  });
});
