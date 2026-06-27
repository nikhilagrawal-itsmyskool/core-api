import {
  Channel, ContactRole, RecipientType,
  TemplateStatus, HeaderType, JobStatus, RecipientStatus,
} from './communication-constants';

// Base interface with common audit fields
export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// --------------------------------------------------------------------- Template
export interface MessageTemplate extends BaseEntity {
  key: string;
  name?: string;
  channel: Channel;
  language?: string;
  provider?: string;
  providerTemplateId?: string;
  category?: string;
  headerType?: HeaderType;
  bodyPreview?: string;
  variables?: string[];
  status: TemplateStatus;
}

export interface CreateTemplateRequest {
  key: string;
  name?: string;
  channel: Channel;
  language?: string;
  provider?: string;
  providerTemplateId?: string;
  category?: string;
  headerType?: HeaderType;
  bodyPreview?: string;
  variables?: string[];
}

export interface UpdateTemplateRequest {
  name?: string;
  language?: string;
  provider?: string;
  providerTemplateId?: string;
  category?: string;
  headerType?: HeaderType;
  bodyPreview?: string;
  variables?: string[];
  status?: 'active' | 'inactive';
}

// --------------------------------------------------------------------- Audience
// Resolved lazily by the worker at send time, so scheduled sends use a live roster.
export interface StudentAudience {
  studentIds?: string[];
  classIds?: string[];
  wingId?: string;
  academicYearId?: string;
  all?: boolean;
}

export interface EmployeeAudience {
  employeeIds?: string[];
  roleIds?: string[];
  all?: boolean;
}

export interface AudienceSpec {
  students?: StudentAudience;
  employees?: EmployeeAudience;
}

// ------------------------------------------------------------------------- Job
export interface MessageJob extends BaseEntity {
  status: JobStatus;
  scheduledAt?: Date;
  templateKey: string;
  language?: string;
  forceChannel?: Channel;
  audience?: AudienceSpec;
  audienceSummary?: string;
  context?: Record<string, any>;
  source?: string;
  workerId?: string;
  heartbeatAt?: Date;
  attempts?: number;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  recipients?: MessageRecipient[];
}

export interface SendMessageRequest {
  templateKey: string;
  language?: string;
  audience: AudienceSpec;
  context?: Record<string, any>;
  scheduledAt?: string;
  forceChannel?: Channel;
  source?: string;
}

export interface PreviewRequest {
  templateKey: string;
  language?: string;
  audience: AudienceSpec;
  context?: Record<string, any>;
  forceChannel?: Channel;
}

// -------------------------------------------------------------------- Recipient
export interface MessageRecipient extends BaseEntity {
  jobId: string;
  recipientType: RecipientType;
  recipientId?: string;
  role?: ContactRole;
  toNumber?: string;
  channel?: Channel;
  templateId?: string;
  context?: Record<string, any>;
  status: RecipientStatus;
  providerMessageId?: string;
  error?: string;
  sentAt?: Date;
}

// One target person resolved from the audience, before the ladder runs.
export interface AudienceTarget {
  recipientType: RecipientType;
  recipientId: string;
  name?: string;
  preference?: string | null;
  // role:channel -> number, e.g. { 'father:whatsapp': '+91...', 'father:sms': '+91...' }
  numbers: Record<string, string | null | undefined>;
  // per-recipient variable context (merged over the job context)
  context: Record<string, any>;
}

// Output of the ladder for one target.
export interface LadderMatch {
  role: ContactRole;
  channel: Channel;
  toNumber: string;
}
