import HealthMonitorService from '../services/infra/HealthMonitorService.js';
import LoadBalancerService from '../services/infra/LoadBalancerService.js';
import logger from '../config/logger.js';

export async function healthCheck() {
  logger.info('[infra] Running server health check...');
  const results = await HealthMonitorService.checkAllServers();
  const { summary } = results;

  if (summary.offline > 0 || summary.unhealthy > 0) {
    logger.warn({ summary }, '[infra] Unhealthy servers detected, attempting auto-migration');
    const migrated = await LoadBalancerService.autoMigrateFromUnhealthy();
    if (migrated.length > 0) {
      logger.info({ migrated: migrated.length }, '[infra] Users auto-migrated');
    }
  }

  return results;
}
