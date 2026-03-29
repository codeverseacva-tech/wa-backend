import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, Span, SpanOptions, context } from '@opentelemetry/api';
import { logger } from './logger';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'zaplink-api',
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

export const initTelemetry = () => {
  sdk.start();
  logger.info('🔭 Telemetry initialized');
  
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => logger.info('🔭 Telemetry shut down'))
      .catch((err) => logger.error('❌ Telemetry shutdown error:', err))
      .finally(() => process.exit(0));
  });
};

/**
 * Helper to start a custom span with context.
 */
export const startSpan = <T>(
  name: string,
  options?: SpanOptions,
  fn?: (span: Span) => Promise<T>
): Promise<T> | Span => {
  const tracer = trace.getTracer('zaplink-api');
  
  if (fn) {
    return tracer.startActiveSpan(name, options || {}, async (span) => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: 2 }); // Error
        span.end();
        throw err;
      }
    });
  }

  return tracer.startSpan(name, options);
};

export { trace, context };
