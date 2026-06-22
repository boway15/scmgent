import { db } from './client.js';
import { fobServiceProviders } from './schema/logistics.js';
const SEEDS = [
    {
        code: 'senwei',
        name: '森威',
        providerType: 'trucking',
        sortOrder: 10,
        isActive: true,
    },
    {
        code: 'huamao',
        name: '华贸',
        providerType: 'freight',
        sortOrder: 10,
        isActive: true,
    },
];
export async function seedFobServiceProviders() {
    let inserted = 0;
    for (const row of SEEDS) {
        const result = await db
            .insert(fobServiceProviders)
            .values(row)
            .onConflictDoNothing({ target: fobServiceProviders.code })
            .returning({ id: fobServiceProviders.id });
        if (result.length)
            inserted++;
    }
    if (inserted > 0) {
        console.log(`FOB service providers: inserted ${inserted} missing provider(s)`);
    }
}
