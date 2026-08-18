import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino from 'pino';

/**
 * Construye la configuración de logging estructurado (Pino) para un servicio.
 *
 * Decisiones "profesionales":
 *   • JSON por defecto → Loki lo parsea con `| json` y permite filtrar por
 *     `level`, `reqId`, `app`, etc. (En local, `LOG_PRETTY=1` activa
 *     `pino-pretty` para leerlo cómodo en la terminal.)
 *   • `reqId` por request (toma `x-request-id` si viene, si no genera uno) →
 *     correlación de todas las líneas de una misma petición HTTP.
 *   • Nivel de log HTTP derivado del status: 5xx→error, 4xx→warn, resto→info.
 *   • Se ignoran los endpoints de ruido (`/metrics`, `/health`) en el
 *     auto-logging para no inundar Loki con los scrapes de Prometheus.
 *   • Se redactan cabeceras sensibles (authorization, cookie).
 *
 * @param app  Nombre lógico del servicio ('producer' | 'consumer'), embebido
 *             como label `app` en cada línea.
 */
export function buildLoggerConfig(app: 'producer' | 'consumer'): Params {
  const isProd = process.env.NODE_ENV === 'production';
  const pretty = process.env.LOG_PRETTY === '1';

  return {
    pinoHttp: {
      base: { app },
      level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
      timestamp: pino.stdTimeFunctions.isoTime,
      // El nivel se serializa como string ("info"/"error") en vez de número,
      // para que en Loki funcione `| json | level="error"`.
      formatters: {
        level: (label) => ({ level: label }),
      },
      genReqId: (req: IncomingMessage) => {
        const header = req.headers['x-request-id'];
        return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      },
      customLogLevel: (_req, res: ServerResponse, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => {
          const url = req.url ?? '';
          return url.includes('/metrics') || url.includes('/health');
        },
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  };
}
