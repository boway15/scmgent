import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, stationSalesRegionMaps, warehouseFulfillmentRegionMaps } from '@scm/db';
import { MAPPABLE_REGIONS } from '../lib/region-codes.js';
import {
  parseMappingCsv,
  parseStationMappingBody,
  parseWarehouseMappingBody,
  toMappingCsv,
} from '../lib/region-mapping-admin.js';
import { invalidateRegionMappingCache } from '../lib/region-mapping.js';
import { listUnmappedStations, listUnmappedWarehouses } from '../lib/region-unmapped-scan.js';
import { requireMenu } from '../lib/rbac.js';

export const regionMappingRoutes = new Hono();

const menuGuard = requireMenu('system.region_mapping', 'data.region_mapping');
regionMappingRoutes.use('*', menuGuard);

async function readCsvText(c: { req: { header: (name: string) => string | undefined; formData: () => Promise<FormData>; text: () => Promise<string> } }): Promise<string> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file') ?? form.get('csv');
    if (file instanceof File) return file.text();
    return typeof file === 'string' ? file : '';
  }
  return c.req.text();
}

regionMappingRoutes.get('/region-mapping/stations/export',  async (c) => {
  const rows = await db
    .select({
      key: stationSalesRegionMaps.station,
      region: stationSalesRegionMaps.salesRegion,
    })
    .from(stationSalesRegionMaps)
    .orderBy(asc(stationSalesRegionMaps.station));
  return c.body(toMappingCsv('station', rows), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="station-region-maps.csv"',
  });
});

regionMappingRoutes.get('/region-mapping/stations',  async (c) => {
  try {
    const [rows, unmappedStations] = await Promise.all([
      db
        .select({
          station: stationSalesRegionMaps.station,
          salesRegion: stationSalesRegionMaps.salesRegion,
        })
        .from(stationSalesRegionMaps)
        .orderBy(asc(stationSalesRegionMaps.station)),
      listUnmappedStations(),
    ]);
    return c.json({
      items: rows,
      unmappedStations,
      regions: MAPPABLE_REGIONS,
    });
  } catch (err) {
    console.error('[region-mapping] stations', err);
    return c.json({ message: '区域映射查询失败' }, 500);
  }
});

regionMappingRoutes.put('/region-mapping/stations',  async (c) => {
  const parsed = parseStationMappingBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
  const now = new Date();
  await db
    .insert(stationSalesRegionMaps)
    .values({ station: parsed.station, salesRegion: parsed.salesRegion, updatedAt: now })
    .onConflictDoUpdate({
      target: stationSalesRegionMaps.station,
      set: { salesRegion: parsed.salesRegion, updatedAt: now },
    });
  invalidateRegionMappingCache();
  return c.json({ station: parsed.station, salesRegion: parsed.salesRegion });
});

regionMappingRoutes.post('/region-mapping/stations/import',  async (c) => {
  const parsed = parseMappingCsv(await readCsvText(c), 'station');
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const row of parsed.rows) {
      await tx
        .insert(stationSalesRegionMaps)
        .values({ station: row.key, salesRegion: row.region, updatedAt: now })
        .onConflictDoUpdate({
          target: stationSalesRegionMaps.station,
          set: { salesRegion: row.region, updatedAt: now },
        });
    }
  });
  invalidateRegionMappingCache();
  return c.json({ imported: parsed.rows.length });
});

regionMappingRoutes.delete('/region-mapping/stations',  async (c) => {
  const queryStation = c.req.query('station')?.trim() ?? '';
  const body = queryStation ? {} : await c.req.json().catch(() => ({}));
  const station = queryStation || (typeof body.station === 'string' ? body.station.trim() : '');
  if (!station) return c.json({ message: 'station is required' }, 400);
  const removed = await db
    .delete(stationSalesRegionMaps)
    .where(eq(stationSalesRegionMaps.station, station))
    .returning({ station: stationSalesRegionMaps.station });
  if (!removed.length) return c.json({ message: 'mapping not found' }, 404);
  invalidateRegionMappingCache();
  return c.json({ deleted: removed.length });
});

regionMappingRoutes.get('/region-mapping/warehouses/export',  async (c) => {
  const rows = await db
    .select({
      key: warehouseFulfillmentRegionMaps.warehouseCode,
      region: warehouseFulfillmentRegionMaps.fulfillmentRegion,
    })
    .from(warehouseFulfillmentRegionMaps)
    .orderBy(asc(warehouseFulfillmentRegionMaps.warehouseCode));
  return c.body(toMappingCsv('warehouse', rows), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="warehouse-region-maps.csv"',
  });
});

regionMappingRoutes.get('/region-mapping/warehouses',  async (c) => {
  try {
    const [rows, unmappedWarehouses] = await Promise.all([
      db
        .select({
          warehouseCode: warehouseFulfillmentRegionMaps.warehouseCode,
          fulfillmentRegion: warehouseFulfillmentRegionMaps.fulfillmentRegion,
        })
        .from(warehouseFulfillmentRegionMaps)
        .orderBy(asc(warehouseFulfillmentRegionMaps.warehouseCode)),
      listUnmappedWarehouses(),
    ]);
    return c.json({
      items: rows,
      unmappedWarehouses,
      regions: MAPPABLE_REGIONS,
    });
  } catch (err) {
    console.error('[region-mapping] warehouses', err);
    return c.json({ message: '区域映射查询失败' }, 500);
  }
});

regionMappingRoutes.put('/region-mapping/warehouses',  async (c) => {
  const parsed = parseWarehouseMappingBody(await c.req.json().catch(() => ({})));
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
  const now = new Date();
  await db
    .insert(warehouseFulfillmentRegionMaps)
    .values({
      warehouseCode: parsed.warehouseCode,
      fulfillmentRegion: parsed.fulfillmentRegion,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: warehouseFulfillmentRegionMaps.warehouseCode,
      set: { fulfillmentRegion: parsed.fulfillmentRegion, updatedAt: now },
    });
  invalidateRegionMappingCache();
  return c.json({
    warehouseCode: parsed.warehouseCode,
    fulfillmentRegion: parsed.fulfillmentRegion,
  });
});

regionMappingRoutes.post('/region-mapping/warehouses/import',  async (c) => {
  const parsed = parseMappingCsv(await readCsvText(c), 'warehouse');
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const row of parsed.rows) {
      await tx
        .insert(warehouseFulfillmentRegionMaps)
        .values({ warehouseCode: row.key, fulfillmentRegion: row.region, updatedAt: now })
        .onConflictDoUpdate({
          target: warehouseFulfillmentRegionMaps.warehouseCode,
          set: { fulfillmentRegion: row.region, updatedAt: now },
        });
    }
  });
  invalidateRegionMappingCache();
  return c.json({ imported: parsed.rows.length });
});

regionMappingRoutes.delete('/region-mapping/warehouses',  async (c) => {
  const queryCode = c.req.query('warehouseCode')?.trim() ?? '';
  const body = queryCode ? {} : await c.req.json().catch(() => ({}));
  const warehouseCode =
    queryCode || (typeof body.warehouseCode === 'string' ? body.warehouseCode.trim() : '');
  if (!warehouseCode) return c.json({ message: 'warehouseCode is required' }, 400);
  const removed = await db
    .delete(warehouseFulfillmentRegionMaps)
    .where(eq(warehouseFulfillmentRegionMaps.warehouseCode, warehouseCode))
    .returning({ warehouseCode: warehouseFulfillmentRegionMaps.warehouseCode });
  if (!removed.length) return c.json({ message: 'mapping not found' }, 404);
  invalidateRegionMappingCache();
  return c.json({ deleted: removed.length });
});
