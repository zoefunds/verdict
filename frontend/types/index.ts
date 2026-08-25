export type CaseStatus =
  | "draft"
  | "open"
  | "awaiting_respondent_stake"
  | "funded"
  | "evidence_window"
  | "under_investigation"
  | "verdict_rendered"
  | "appeal_window"
  | "appealed"
  | "re_investigation"
  | "final"
  | "settled"
  | "cancelled"
  | "abandoned";

export type CaseVisibility = "public" | "private";
export type ParticipantRole = "claimant" | "respondent";
export type EvidenceType = "url" | "document" | "image" | "transaction_record" | "text_statement";
export type EvidenceStatus = "submitted" | "pending_review" | "verified" | "verification_failed" | "disputed";

export interface Case {
  id: string;
  contractCaseId: string | null;
  caseNumber: string;
  title: string;
  claimText: string;
  resolutionRule: string;
  category: string;
  status: CaseStatus;
  visibility: CaseVisibility;
  constitutionVersionId: string;
  caseRules: string[];
  createdByUserId: string;
  respondentAddress: string | null;
  stakeAmountWei: string;
  appealBondAmountWei: string;
  evidenceWindowHours: number;
  appealWindowHours: number;
  evidenceWindowClosesAt: string | null;
  appealWindowClosesAt: string | null;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
}

export interface CaseParticipant {
  id: string;
  caseId: string;
  userId: string;
  role: ParticipantRole;
  stakeLockedAt: string | null;
  stakeTxHash: string | null;
  joinedAt: string;
}

export interface Evidence {
  id: string;
  caseId: string;
  submittedByUserId: string;
  contractEvidenceId: string | null;
  evidenceType: EvidenceType;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  fileStoragePath: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  textContent: string | null;
  contentHashSha256: string;
  status: EvidenceStatus;
  provenance: "participant_submitted" | "contract_verified";
  isAppealEvidence: boolean;
  submittedAt: string;
}

export interface User {
  id: string;
  walletAddress: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ConstitutionVersion {
  id: string;
  constitutionId: string;
  versionNumber: number;
  contractVersionRef: string | null;
  changeSummary: string | null;
  isCurrent: boolean;
  publishedAt: string;
  casesResolvedCount: number;
  appealsCount: number;
  overturnsCount: number;
}

export interface ConstitutionArticle {
  id: string;
  constitutionVersionId: string;
  articleNumber: number;
  title: string;
  body: string;
  isImmutableCore: boolean;
  displayOrder: number;
}

export type NotificationType =
  | "case_stake_required"
  | "case_funded"
  | "evidence_submitted"
  | "verdict_rendered"
  | "appeal_window_opened"
  | "appeal_filed"
  | "case_settled"
  | "case_abandoned_recoverable";

export interface Notification {
  id: string;
  userId: string;
  caseId: string | null;
  type: NotificationType;
  message: string;
  readAt: string | null;
  createdAt: string;
}
