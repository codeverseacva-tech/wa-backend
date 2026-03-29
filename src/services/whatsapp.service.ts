import { 
  makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState, 
  ConnectionState 
} from '@whiskeysockets/baileys';
import { logger } from '@/lib/logger';

export class WhatsappService {
  public static async initSession(sessionId: string) {
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${sessionId}`);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      logger: logger as any,
    });

    sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.warn(`Connection closed due to ${lastDisconnect?.error}, reconnecting ${shouldReconnect}`);
        if (shouldReconnect) {
          this.initSession(sessionId);
        }
      } else if (connection === 'open') {
        logger.info('✅ WhatsApp connection opened');
      }
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
  }
}
