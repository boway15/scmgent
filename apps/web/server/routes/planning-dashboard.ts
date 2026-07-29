import { Hono } from 'hono';
import { getPlanningDashboard } from '../lib/planning-dashboard.js';
import { requireMenu } from '../lib/rbac.js';

export const planningDashboardRoutes = new Hono();

planningDashboardRoutes.get(
  '/planning/dashboard',
  requireMenu('inventory.planning_dashboard'),
  async (c) => c.json(await getPlanningDashboard()),
);
