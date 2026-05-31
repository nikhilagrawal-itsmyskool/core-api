import { DB, singleLineString } from '../../shared/lib/db';
import { FineCollection, CollectFineRequest } from './fine-interfaces';
import { fineNoteService } from './fine-note-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class FineCollectionService {
  public async collect(
    incidentId: string,
    data: CollectFineRequest,
    schoolId: string,
    userId: string
  ): Promise<FineCollection> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const collectedById = data.collectedById || userId;
    const receiptNumber = this.generateReceiptNumber();

    // Insert collection record
    const insertQuery = singleLineString`
      insert into fine_collection
      (uuid, incident_id, school_id, amount_collected, collection_date, payment_method,
       receipt_number, notes, collected_by_id, createdby_userid, created_at, status)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
      returning *
    `;

    const insertParams = [
      uuid,
      incidentId,
      schoolId,
      data.amountCollected,
      data.collectionDate,
      data.paymentMethod || null,
      receiptNumber,
      data.notes || null,
      collectedById,
      userId,
      now,
    ];

    await DB.query(insertQuery, insertParams);

    // Add system note
    await fineNoteService.createSystemNote(
      incidentId,
      schoolId,
      userId,
      `Fine collected ₹${data.amountCollected}. Receipt: ${receiptNumber}`
    );

    // Check if incident should be auto-closed (total collected >= decided amount)
    const incidentRows = await DB.query(
      `select decided_fine_amount from fine_incident where uuid = $1 and school_id = $2`,
      [incidentId, schoolId]
    );
    const decidedFineAmount = incidentRows.length > 0 && incidentRows[0].decidedFineAmount != null
      ? parseFloat(incidentRows[0].decidedFineAmount)
      : null;

    const sumRows = await DB.query(
      `select coalesce(sum(amount_collected), 0) as total from fine_collection where incident_id = $1 and school_id = $2 and status = 'active'`,
      [incidentId, schoolId]
    );
    const totalCollected = parseFloat(sumRows[0].total);

    const shouldClose = decidedFineAmount === null || totalCollected >= decidedFineAmount;
    if (shouldClose) {
      await DB.query(
        `update fine_incident set status = 'closed', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
        [userId, now, incidentId, schoolId]
      );
      await fineNoteService.createSystemNote(incidentId, schoolId, userId, 'Fine fully collected. Incident closed.');
    }

    const results = await DB.query(
      `select * from fine_collection where uuid = $1 and school_id = $2`,
      [uuid, schoolId]
    );
    return this.parseNumericFields(results[0]);
  }

  public async listCollections(incidentId: string, schoolId: string): Promise<FineCollection[]> {
    const query = singleLineString`
      select * from fine_collection
      where incident_id = $1 and school_id = $2 and status = 'active'
      order by created_at asc
    `;
    const results = await DB.query(query, [incidentId, schoolId]);
    return results.map((r: any) => this.parseNumericFields(r));
  }

  public async getReceipt(incidentId: string, schoolId: string): Promise<FineCollection | null> {
    const query = singleLineString`
      select * from fine_collection
      where incident_id = $1 and school_id = $2 and status = 'active'
      order by created_at asc
      limit 1
    `;
    const results = await DB.query(query, [incidentId, schoolId]);
    return results.length > 0 ? this.parseNumericFields(results[0]) : null;
  }

  private parseNumericFields(collection: any): any {
    return {
      ...collection,
      amountCollected: collection.amountCollected != null ? parseFloat(collection.amountCollected) : null,
    };
  }

  private generateReceiptNumber(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = generateShortUuid(6).toUpperCase();
    return `FINE-${dateStr}-${random}`;
  }
}

export const fineCollectionService = new FineCollectionService();
