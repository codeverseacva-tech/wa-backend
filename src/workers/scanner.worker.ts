import { Worker, Job } from 'bullmq';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

export class ScanWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'scanner-queue',
      async (job: Job) => {
        logger.info(`Processing job ${job.id}: ${job.name}`);
        // Add job processing logic here
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { success: true };
      },
      { connection: redis }
    );

    this.worker.on('failed', (job, err) => {
      logger.error({ job: job?.id, err }, 'Job failed');
    });

    this.worker.on('completed', (job) => {
      logger.info(`Job ${job.id} completed successfully`);
    });
  }

  public getWorker() {
    return this.worker;
  }
}
