import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from '../../application/ports/email-sender.port';

/**
 * Adaptador de desarrollo del puerto `EmailSender` (ADR-0011): no envía nada
 * real, imprime el email al logger. Permite ejercitar verificación y reset
 * end-to-end sin proveedor ni secretos — el link (con el token) queda visible
 * en el log. El proveedor real (SMTP/SES/Resend) será otro adaptador que
 * implementa el mismo puerto, sin tocar `identity`.
 */
@Injectable()
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('EmailSender:log');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`EMAIL → ${message.to} · ${message.subject}\n${message.text}`);
  }
}
