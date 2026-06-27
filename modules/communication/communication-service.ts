import { DB, singleLineString } from '../../shared/lib/db';

class CommunicationService {
  // Resolve a school's internal uuid from its public code.
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const results = await DB.query(
      singleLineString`select uuid from school where lower(code) = lower($1)`,
      [schoolCode],
    );
    return results.length > 0 ? results[0].uuid : null;
  }
}

export const communicationService = new CommunicationService();
