import { Controller, Get } from '@nestjs/common';
import { DbService } from '../../db/db.service';

@Controller()
export class IdentityController {
  constructor(private readonly db: DbService) {}

  @Get('organizations/current')
  async currentOrganization() {
    return this.db.one(
      `SELECT id, name, legal_name, country_code, default_currency, default_locale, timezone, unit_system
       FROM organizations WHERE id = $1`,
      [this.db.tenant],
    );
  }

  @Get('farms')
  async farms() {
    return this.db.query(
      `SELECT f.id, f.name, f.official_code, f.total_area_ha,
              (SELECT count(*)::int FROM animals a WHERE a.farm_id = f.id AND a.status = 'active' AND a.deleted_at IS NULL) AS active_animals
       FROM farms f WHERE f.tenant_id = $1 AND f.deleted_at IS NULL ORDER BY f.created_at`,
      [this.db.tenant],
    );
  }
}
