import { DB, singleLineString } from '../../shared/lib/db';
import { SportIncharge } from './sport-interfaces';
import { DEFAULTS } from './sport-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SportInchargeService {
  public async listAll(schoolId: string): Promise<SportIncharge[]> {
    const query = singleLineString`
      select ic.*, e.name as in_charge_name
      from sport_incharge ic
      left join employee e on ic.in_charge_id = e.uuid
      where ic.school_id = $1 and ic.status = 'active'
      order by ic.sport_type, e.name
    `;
    return DB.query(query, [schoolId]);
  }

  public async getBySport(schoolId: string, sportType: string): Promise<SportIncharge[]> {
    const query = singleLineString`
      select ic.*, e.name as in_charge_name
      from sport_incharge ic
      left join employee e on ic.in_charge_id = e.uuid
      where ic.school_id = $1 and ic.sport_type = $2 and ic.status = 'active'
      order by e.name
    `;
    return DB.query(query, [schoolId, sportType]);
  }

  // Replace the full in-charge list for a sport: soft-delete the current active
  // rows then insert the new set, all in one transaction.
  public async setForSport(
    schoolId: string,
    sportType: string,
    inChargeIds: string[],
    userId: string
  ): Promise<SportIncharge[]> {
    const now = new Date();
    const uniqueIds = [...new Set(inChargeIds.filter((id) => id && id.trim()))];

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      update sport_incharge
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where school_id = $3 and sport_type = $4 and status = 'active'
    `);
    params.push([userId, now, schoolId, sportType]);

    for (const inChargeId of uniqueIds) {
      queries.push(singleLineString`
        insert into sport_incharge
        (uuid, sport_type, in_charge_id, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
      `);
      params.push([generateShortUuid(12), sportType, inChargeId, DEFAULTS.STATUS, schoolId, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getBySport(schoolId, sportType);
  }
}

export const sportInchargeService = new SportInchargeService();
