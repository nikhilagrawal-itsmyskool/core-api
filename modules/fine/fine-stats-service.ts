import { DB, singleLineString } from '../../shared/lib/db';

export interface FineStats {
  byStatus: {
    open: number;
    under_review: number;
    decision_made: number;
    closed: number;
  };
  totalIncidents: number;
  totalCollectedAmount: number;
  totalOutstandingAmount: number;
}

class FineStatsService {
  public async getStats(schoolId: string): Promise<FineStats> {
    const statusQuery = singleLineString`
      select status, count(*)::int as count
      from fine_incident
      where school_id = $1
      group by status
    `;

    const outstandingQuery = singleLineString`
      select coalesce(sum(decided_fine_amount), 0)::numeric as total
      from fine_incident
      where school_id = $1
        and status = 'decision_made'
        and decision = 'collect'
        and decided_fine_amount is not null
    `;

    const collectedQuery = singleLineString`
      select coalesce(sum(fc.amount_collected), 0)::numeric as total
      from fine_collection fc
      join fine_incident fi on fc.incident_id = fi.uuid
      where fc.school_id = $1 and fc.status = 'active' and fi.status = 'closed'
    `;

    const [statusRows, outstandingRows, collectedRows] = await Promise.all([
      DB.query(statusQuery, [schoolId]),
      DB.query(outstandingQuery, [schoolId]),
      DB.query(collectedQuery, [schoolId]),
    ]);

    const byStatus = { open: 0, under_review: 0, decision_made: 0, closed: 0 };
    let totalIncidents = 0;
    for (const row of statusRows) {
      if (row.status in byStatus) {
        byStatus[row.status as keyof typeof byStatus] = row.count;
        totalIncidents += row.count;
      }
    }

    const totalOutstandingAmount = parseFloat(outstandingRows[0]?.total ?? 0);
    const totalCollectedAmount = parseFloat(collectedRows[0]?.total ?? 0);

    return {
      byStatus,
      totalIncidents,
      totalCollectedAmount,
      totalOutstandingAmount,
    };
  }
}

export const fineStatsService = new FineStatsService();
