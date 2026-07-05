import { Controller, Get } from '@nestjs/common';
import { DbService } from '../../db/db.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly db: DbService) {}

  @Get('kpis')
  async kpis() {
    const t = this.db.tenant;

    const [actives, byCategory, avgAdg, pregnancy, withdrawals, vaccinesDue, weightSeries, recent] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month
         FROM animals WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [t],
      ),
      this.db.query<any>(
        `SELECT c.name AS category, count(*)::int AS n
         FROM animals a JOIN animal_categories c ON c.id = a.category_id
         WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
         GROUP BY c.name ORDER BY n DESC`,
        [t],
      ),
      this.db.one<any>(
        `SELECT avg(adg_since_last)::float AS adg
         FROM weighings WHERE tenant_id = $1 AND adg_since_last IS NOT NULL AND adg_since_last > 0
           AND weighed_at >= now() - interval '120 days'`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE p.status = 'open')::int AS open,
                (SELECT count(*)::int FROM animals a JOIN animal_categories c ON c.id = a.category_id
                 WHERE a.tenant_id = $1 AND a.status = 'active' AND c.code IN ('vaca','vaquillona') AND a.deleted_at IS NULL) AS breeding_females
         FROM pregnancies p WHERE p.tenant_id = $1 AND p.deleted_at IS NULL`,
        [t],
      ),
      this.db.query<any>(
        `SELECT tr.meat_withdrawal_until, ai.value AS tag, a.id AS animal_id, pv.name AS product
         FROM treatments tr
         JOIN animals a ON a.id = tr.animal_id
         LEFT JOIN products_veterinary pv ON pv.id = tr.product_id
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
         WHERE tr.tenant_id = $1 AND tr.meat_withdrawal_until >= CURRENT_DATE AND tr.deleted_at IS NULL
         ORDER BY tr.meat_withdrawal_until LIMIT 10`,
        [t],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM vaccinations
         WHERE tenant_id = $1 AND next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND deleted_at IS NULL`,
        [t],
      ),
      this.db.query<any>(
        `SELECT to_char(date_trunc('month', weighed_at), 'YYYY-MM') AS month, avg(weight_kg)::float AS avg_kg, count(*)::int AS n
         FROM weighings WHERE tenant_id = $1 AND weighed_at >= now() - interval '12 months' AND deleted_at IS NULL
         GROUP BY 1 ORDER BY 1`,
        [t],
      ),
      this.db.query<any>(
        `SELECT e.event_type, e.payload, e.occurred_at, ai.value AS tag, e.animal_id
         FROM animal_events e
         LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = e.animal_id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
         WHERE e.tenant_id = $1 ORDER BY e.occurred_at DESC LIMIT 12`,
        [t],
      ),
    ]);

    return {
      active_animals: actives?.n ?? 0,
      new_this_month: actives?.new_this_month ?? 0,
      by_category: byCategory,
      avg_adg_kg_day: avgAdg?.adg ? +avgAdg.adg.toFixed(2) : null,
      pregnancy: {
        open: pregnancy?.open ?? 0,
        breeding_females: pregnancy?.breeding_females ?? 0,
        rate: pregnancy?.breeding_females ? +((pregnancy.open / pregnancy.breeding_females) * 100).toFixed(1) : null,
      },
      alerts: {
        active_withdrawals: withdrawals,
        vaccinations_due_30d: vaccinesDue?.n ?? 0,
      },
      weight_series: weightSeries,
      recent_events: recent,
    };
  }
}
