import { ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';

export function getSchoolCodeFromHeader(event: ApiEvent): string | null {
  const headers = event.headers || {};
  
  // Try case-insensitive lookup (API Gateway may lowercase headers)
  const schoolCode = 
    headers['X-School-Code'] || 
    headers['x-school-code'] ||
    headers['X-SCHOOL-CODE'] ||
    null;
  
  return schoolCode;
}

export function validateSchoolCodeHeader(event: ApiEvent): string {
  const schoolCode = getSchoolCodeFromHeader(event);
  
  if (!schoolCode || schoolCode.trim() === '') {
    throw new Error(`${ErrorCode.InvalidInput}: School code header (X-School-Code) is required`);
  }
  
  return schoolCode.trim();
}

