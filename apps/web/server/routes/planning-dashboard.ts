import { Hono } from 'hono';
import { getInventoryRiskCounts } from '../lib/alert-action-index.js';
import { getPlanningDashboard } from '../lib/planning-dashboard.js';
import { getPlanningDemandSource } from '../lib/planning-demand-source.js';
import { requireMenu } from '../lib/rbac.js';
import { parseProductScope } from '../lib/planning-accessory-filter.js';

export const planningDashboardRoutes = new Hono();

planningDashboardRoutes.get(
  '/planning/dashboard/risk',
  requireMenu('inventory.planning_dashboard'),
  async (c) => c.json(await getInventoryRiskCounts(parseProductScope(c.req.query('productScope')))),
);

planningDashboardRoutes.get(
  '/planning/demand-source',
  requireMenu('inventory.planning_dashboard', 'data.forecast'),
  async (c) => c.json(await getPlanningDemandSource()),
);

planningDashboardRoutes.get(
  '/planning/dashboard',
  requireMenu('inventory.planning_dashboard'),
  async (c) =>
    c.json(await getPlanningDashboard(undefined, parseProductScope(c.req.query('productScope')))),
);
