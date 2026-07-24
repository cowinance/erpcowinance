import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from '../../application/ports/email-sender.port';

export interface SmtpConfig {
  host: string;
  port: number;
  /** `true` = TLS desde el saludo (puerto 465). `false` = STARTTLS si el servidor lo ofrece (587). */
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Adaptador de PRODUCCIÓN del puerto `EmailSender` (ADR-0011). Habla SMTP, así que sirve con
 * cualquier proveedor —SES, Postmark, Mailgun, Resend, Gmail o un relay propio— sin un adaptador
 * por cada uno.
 *
 * POR QUÉ IMPORTA: hasta ahora el único adaptador era `LogEmailSender`, que IMPRIME el correo.
 * En producción eso dejaba rotos los dos flujos que dependen de que el mail llegue: la
 * verificación de email y el reset de contraseña. El usuario nunca recibía el link.
 *
 * `nodemailer` es la única dependencia que se sumó, y no tiene dependencias propias: implementar
 * SMTP a mano (EHLO, STARTTLS, AUTH, DATA, más las rarezas de TLS de cada proveedor) sería el
 * tipo de código que falla en producción contra un proveedor concreto y no en los tests.
 */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender:smtp');
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      const info = await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      // Se registra el destinatario y el id del proveedor, NUNCA el cuerpo: los emails de
      // verificación y reset llevan el token en claro, y un log no es lugar para eso.
      this.logger.log(`Enviado a ${message.to} · ${message.subject} · id=${info.messageId}`);
    } catch (e) {
      this.logger.error(`Falló el envío a ${message.to} (${message.subject}): ${(e as Error).message}`);
      throw e;
    }
  }

  /** Comprueba la conexión y las credenciales sin mandar nada. */
  verify(): Promise<true> {
    return this.transport.verify() as Promise<true>;
  }
}

/**
 * Lee la configuración del entorno. Falla ruidosamente si falta algo: un SMTP mal configurado que
 * arranca igual solo posterga el descubrimiento hasta que un usuario real se quede sin poder
 * recuperar su contraseña.
 */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  const missing = [!host && 'SMTP_HOST', !from && 'SMTP_FROM'].filter(Boolean);
  if (missing.length > 0)
    throw new Error(`EMAIL_PROVIDER=smtp pero faltan variables: ${missing.join(', ')}. Ver .env.example.`);

  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error(`SMTP_PORT inválido: "${env.SMTP_PORT}".`);

  const user = env.SMTP_USER?.trim() || undefined;
  if (user && !env.SMTP_PASS)
    throw new Error('SMTP_USER está definida pero SMTP_PASS no: la autenticación fallaría en el primer envío.');

  return {
    host: host!,
    port,
    // Implícito en 465 por convención; en 587 se negocia STARTTLS. Override con SMTP_SECURE.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === 'true' : port === 465,
    user,
    pass: env.SMTP_PASS,
    from: from!,
  };
}
