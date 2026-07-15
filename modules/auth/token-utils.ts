const jwt = require('jsonwebtoken');

export interface DecodedToken {
  id: string;
  employee_id?: string;
  login_name: string;
  school_id: string;
  school_code: string;
  type: string;
  roles: string[];
  // Family login only: the sibling id/name allowlist embedded at login time.
  // Absent on employee tokens.
  students?: Array<{ id: string; name: string }>;
}

export function extractAndVerifyToken(authorizationHeader: string | undefined): DecodedToken | null {
  if (!authorizationHeader) {
    return null;
  }

  const token = authorizationHeader.replace('Bearer ', '').trim();
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || decoded.auth !== process.env.JWT_MAGIC_KEY) {
      return null;
    }

    return {
      id: decoded.id,
      employee_id: decoded.employee_id,
      login_name: decoded.login_name,
      school_id: decoded.school_id,
      school_code: decoded.school_code,
      type: decoded.type,
      roles: decoded.roles,
      students: decoded.students,
    };
  } catch (err) {
    return null;
  }
}
