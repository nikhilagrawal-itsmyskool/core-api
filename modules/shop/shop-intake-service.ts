import { DB, singleLineString } from '../../shared/lib/db';
import { ShopSetIntake, CreateIntakeRequest } from './shop-interfaces';
import { DEFAULTS } from './shop-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ShopIntakeService {
  // Record a set intake ("received N sets for grade G"). grade + session are
  // snapshotted from the set so intake rows stay meaningful if the set changes.
  public async createIntake(data: CreateIntakeRequest, schoolId: string, userId: string): Promise<ShopSetIntake | null> {
    const sets = await DB.query(
      `select grade, academic_session from shop_set where uuid = $1 and school_id = $2 and status = 'active'`,
      [data.setId, schoolId]
    );
    if (sets.length === 0) return null;
    const set = sets[0];

    const uuid = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`
        insert into shop_set_intake
        (uuid, school_id, set_id, grade, academic_session, qty_sets, unit_cost, supplier,
         intake_date, notes, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        uuid, schoolId, data.setId, set.grade, set.academicSession,
        data.qtySets, data.unitCost ?? null, data.supplier || null,
        data.intakeDate, data.notes || null, DEFAULTS.STATUS, userId, now,
      ]
    );
    return this.getIntake(uuid, schoolId);
  }

  public async getIntake(id: string, schoolId: string): Promise<ShopSetIntake | null> {
    const rows = await DB.query(
      singleLineString`
        select i.*, s.name as set_name
        from shop_set_intake i
        left join shop_set s on i.set_id = s.uuid
        where i.uuid = $1 and i.school_id = $2 and i.status = 'active'
      `,
      [id, schoolId]
    );
    if (rows.length === 0) return null;
    return this.parseNumeric(rows[0]);
  }

  public async listIntakes(schoolId: string, filters: {
    setId?: string;
    grade?: string;
    academicSession?: string;
  }): Promise<ShopSetIntake[]> {
    let query = singleLineString`
      select i.*, s.name as set_name
      from shop_set_intake i
      left join shop_set s on i.set_id = s.uuid
      where i.school_id = $1 and i.status = 'active'
    `;
    const queryParams: any[] = [schoolId];
    let p = 2;
    if (filters.setId) { query += ` and i.set_id = $${p++}`; queryParams.push(filters.setId); }
    if (filters.grade) { query += ` and i.grade = $${p++}`; queryParams.push(filters.grade); }
    if (filters.academicSession) { query += ` and i.academic_session = $${p++}`; queryParams.push(filters.academicSession); }
    query += ` order by i.intake_date desc, i.created_at desc`;

    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => this.parseNumeric(r));
  }

  public async deleteIntake(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getIntake(id, schoolId);
    if (!existing) return false;
    await DB.query(
      `update shop_set_intake set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
      [userId, new Date(), id, schoolId]
    );
    return true;
  }

  private parseNumeric(row: any): ShopSetIntake {
    return {
      ...row,
      qtySets: parseInt(row.qtySets, 10) || 0,
      unitCost: row.unitCost != null ? parseFloat(row.unitCost) : undefined,
    };
  }
}

export const shopIntakeService = new ShopIntakeService();
