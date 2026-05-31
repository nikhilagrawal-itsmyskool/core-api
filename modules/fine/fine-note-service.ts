import { DB, singleLineString } from '../../shared/lib/db';
import { FineIncidentNote, CreateNoteRequest } from './fine-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class FineNoteService {
  public async create(
    incidentId: string,
    data: CreateNoteRequest,
    schoolId: string,
    userId: string
  ): Promise<FineIncidentNote> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const authorId = data.authorId || userId;
    const authorType = data.authorType || 'employee';

    const query = singleLineString`
      insert into fine_incident_note
      (uuid, incident_id, school_id, author_id, author_type, note_text, note_type, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, 'comment', $7, $8)
      returning *
    `;

    const results = await DB.query(query, [
      uuid,
      incidentId,
      schoolId,
      authorId,
      authorType,
      data.noteText,
      userId,
      now,
    ]);

    return this.enrichWithAuthorName(results[0]);
  }

  public async createSystemNote(
    incidentId: string,
    schoolId: string,
    userId: string,
    noteText: string
  ): Promise<void> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fine_incident_note
      (uuid, incident_id, school_id, author_id, author_type, note_text, note_type, createdby_userid, created_at)
      values ($1, $2, $3, $4, 'employee', $5, 'system', $6, $7)
    `;

    await DB.query(query, [uuid, incidentId, schoolId, userId, noteText, userId, now]);
  }

  public async list(incidentId: string, schoolId: string): Promise<FineIncidentNote[]> {
    // author_id for employee notes is employee_login.uuid (from JWT id claim)
    const query = singleLineString`
      select n.*,
        case when n.author_type = 'employee' then el.display_name else s.name end as author_name
      from fine_incident_note n
      left join employee_login el on n.author_type = 'employee' and n.author_id = el.uuid
      left join student s on n.author_type = 'student' and n.author_id = s.uuid
      where n.incident_id = $1 and n.school_id = $2
      order by n.created_at asc
    `;

    return DB.query(query, [incidentId, schoolId]);
  }

  private async enrichWithAuthorName(note: FineIncidentNote): Promise<FineIncidentNote> {
    if (note.authorType === 'employee') {
      // author_id is employee_login.uuid — look up display_name there
      const results = await DB.query(`select display_name from employee_login where uuid = $1`, [note.authorId]);
      note.authorName = results.length > 0 ? results[0].displayName : undefined;
    } else {
      const results = await DB.query(`select name from student where uuid = $1`, [note.authorId]);
      note.authorName = results.length > 0 ? results[0].name : undefined;
    }
    return note;
  }
}

export const fineNoteService = new FineNoteService();
