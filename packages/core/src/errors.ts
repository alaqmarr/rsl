export interface ErrorCatalogEntry {
  code: string;
  httpStatus: number;
  title: string;
  userMessage: string;
  remediation: string;
  docsSlug: string;
  retryable: boolean;
  domain:
    | "auth"
    | "permissions"
    | "billing"
    | "business"
    | "validation"
    | "whatsapp"
    | "meta"
    | "tally"
    | "google"
    | "backup"
    | "api"
    | "system";
}

export const ERROR_CATALOG = {
  "RSL-AUTH-1001": {
    code: "RSL-AUTH-1001",
    httpStatus: 401,
    title: "Sign-in required",
    userMessage: "Your session has ended. Please sign in again to continue.",
    remediation: "Go to the Sign In page and enter your email and password.",
    docsSlug: "errors/RSL-AUTH-1001",
    retryable: false,
    domain: "auth",
  },
  "RSL-AUTH-1002": {
    code: "RSL-AUTH-1002",
    httpStatus: 401,
    title: "Incorrect email or password",
    userMessage: "The email address or password you entered does not match any account.",
    remediation: "Check for typos in your email address or reset your password if needed.",
    docsSlug: "errors/RSL-AUTH-1002",
    retryable: false,
    domain: "auth",
  },
  "RSL-AUTH-1003": {
    code: "RSL-AUTH-1003",
    httpStatus: 409,
    title: "Account already exists",
    userMessage: "An account with this email address is already registered.",
    remediation: "Sign in with your existing password instead of creating a new account.",
    docsSlug: "errors/RSL-AUTH-1003",
    retryable: false,
    domain: "auth",
  },
  "RSL-RBAC-1001": {
    code: "RSL-RBAC-1001",
    httpStatus: 403,
    title: "Permission needed",
    userMessage: "Your current team role does not allow this action.",
    remediation: "Ask your Business Owner or Admin to update your role in Team Settings.",
    docsSlug: "errors/RSL-RBAC-1001",
    retryable: false,
    domain: "permissions",
  },
  "RSL-RBAC-1002": {
    code: "RSL-RBAC-1002",
    httpStatus: 403,
    title: "Account access restricted",
    userMessage: "Your profile is not assigned to manage this connected account or page.",
    remediation: "Ask a Business Admin to grant access to this specific page or phone number.",
    docsSlug: "errors/RSL-RBAC-1002",
    retryable: false,
    domain: "permissions",
  },
  "RSL-BILL-1001": {
    code: "RSL-BILL-1001",
    httpStatus: 402,
    title: "Plan add-on not active",
    userMessage: "This feature is not active on your current business plan.",
    remediation: "Open Plans & Wallet to request activation for this feature.",
    docsSlug: "errors/RSL-BILL-1001",
    retryable: false,
    domain: "billing",
  },
  "RSL-BILL-1002": {
    code: "RSL-BILL-1002",
    httpStatus: 400,
    title: "Required plan missing",
    userMessage: "This add-on needs another plan active first before it can be turned on.",
    remediation: "Request activation of the required base plan on the Plans & Wallet page first.",
    docsSlug: "errors/RSL-BILL-1002",
    retryable: false,
    domain: "billing",
  },
  "RSL-BILL-1003": {
    code: "RSL-BILL-1003",
    httpStatus: 402,
    title: "Wallet overdraft limit reached (-₹200)",
    userMessage:
      "Your prepaid wallet has reached the -₹200.00 overdraft limit and cannot complete this metered request.",
    remediation: "Add funds to your Prepaid Wallet on the Plans & Wallet page to clear the negative balance and continue.",
    docsSlug: "errors/RSL-BILL-1003",
    retryable: false,
    domain: "billing",
  },
  "RSL-TENANT-1001": {
    code: "RSL-TENANT-1001",
    httpStatus: 423,
    title: "Business data temporarily locked",
    userMessage: "Your business account is currently running a backup restore or update.",
    remediation: "Wait a moment for the update to finish and refresh the page.",
    docsSlug: "errors/RSL-TENANT-1001",
    retryable: true,
    domain: "business",
  },
  "RSL-TENANT-1002": {
    code: "RSL-TENANT-1002",
    httpStatus: 403,
    title: "Account paused",
    userMessage: "Your business account is paused due to an overdue bill. Your data is safe and viewable.",
    remediation: "Visit Plans & Wallet to clear the pending invoice and resume sending.",
    docsSlug: "errors/RSL-TENANT-1002",
    retryable: false,
    domain: "business",
  },
  "RSL-VAL-1001": {
    code: "RSL-VAL-1001",
    httpStatus: 400,
    title: "Check the details entered",
    userMessage: "Some fields are missing or formatted incorrectly.",
    remediation: "Review the highlighted fields in the form and correct them.",
    docsSlug: "errors/RSL-VAL-1001",
    retryable: false,
    domain: "validation",
  },
  "RSL-WA-1001": {
    code: "RSL-WA-1001",
    httpStatus: 400,
    title: "24-hour reply window closed",
    userMessage: "More than 24 hours have passed since this customer last messaged you on WhatsApp.",
    remediation: "Choose an approved WhatsApp Template message instead of a free-text reply.",
    docsSlug: "errors/RSL-WA-1001",
    retryable: false,
    domain: "whatsapp",
  },
  "RSL-WA-1002": {
    code: "RSL-WA-1002",
    httpStatus: 400,
    title: "Customer has unsubscribed",
    userMessage: "This phone number asked to stop receiving messages and is on your blocked list.",
    remediation: "Do not message unsubscribed numbers unless the customer messages you first to opt back in.",
    docsSlug: "errors/RSL-WA-1002",
    retryable: false,
    domain: "whatsapp",
  },
  "RSL-WA-1003": {
    code: "RSL-WA-1003",
    httpStatus: 400,
    title: "Customer permission required",
    userMessage: "This contact does not have recorded permission to receive WhatsApp template messages.",
    remediation: "Record how the customer agreed to receive WhatsApp updates on their contact card first.",
    docsSlug: "errors/RSL-WA-1003",
    retryable: false,
    domain: "whatsapp",
  },
  "RSL-TALLY-1001": {
    code: "RSL-TALLY-1001",
    httpStatus: 401,
    title: "Pairing code expired or invalid",
    userMessage: "That Tally connector code has expired or was already used.",
    remediation: "Generate a fresh 15-minute pairing code from Tally Bills & Sync.",
    docsSlug: "errors/RSL-TALLY-1001",
    retryable: false,
    domain: "tally",
  },
  "RSL-TALLY-1002": {
    code: "RSL-TALLY-1002",
    httpStatus: 401,
    title: "Tally connector signature invalid",
    userMessage: "The sync request from the Tally PC connector could not be verified.",
    remediation: "Check that your PC clock is accurate or re-pair the Tally connector.",
    docsSlug: "errors/RSL-TALLY-1002",
    retryable: false,
    domain: "tally",
  },
  "RSL-SYNC-CIRCUIT-BREAKER": {
    code: "RSL-SYNC-CIRCUIT-BREAKER",
    httpStatus: 409,
    title: "Empty Tally snapshot blocked for data safety",
    userMessage:
      "Tally Prime returned 0 bills for a company that already has synced bills. Automatic deletion was blocked to protect your data while Tally restarts or loads.",
    remediation:
      "Ensure the correct company is open in Tally Prime and try syncing again. If you intentionally deleted every bill in the company, confirm an explicit empty Day Book reset.",
    docsSlug: "errors/RSL-SYNC-CIRCUIT-BREAKER",
    retryable: true,
    domain: "tally",
  },
  "RSL-BACKUP-1001": {
    code: "RSL-BACKUP-1001",
    httpStatus: 400,
    title: "Backup file could not be verified",
    userMessage: "This backup file does not have a valid RSL security signature and was rejected for safety.",
    remediation: "Only restore official .rslbackup files created by RSL Marketing.",
    docsSlug: "errors/RSL-BACKUP-1001",
    retryable: false,
    domain: "backup",
  },
  "RSL-BACKUP-1002": {
    code: "RSL-BACKUP-1002",
    httpStatus: 400,
    title: "Backup format mismatch",
    userMessage: "This backup file does not match the expected RSL backup format and was blocked for safety.",
    remediation: "Contact support with the backup date if this file came from your storage folder.",
    docsSlug: "errors/RSL-BACKUP-1002",
    retryable: false,
    domain: "backup",
  },
  "RSL-API-1001": {
    code: "RSL-API-1001",
    httpStatus: 401,
    title: "Invalid or expired API key",
    userMessage: "The API key sent in the Authorization header is invalid, expired, or revoked.",
    remediation: "Create a new API key under Developer API Keys and update your integration.",
    docsSlug: "errors/RSL-API-1001",
    retryable: false,
    domain: "api",
  },
  "RSL-API-1002": {
    code: "RSL-API-1002",
    httpStatus: 403,
    title: "API key scope missing",
    userMessage: "This API key does not have permission for this endpoint.",
    remediation: "Generate an API key with the required scope enabled in Developer API Keys.",
    docsSlug: "errors/RSL-API-1002",
    retryable: false,
    domain: "api",
  },
  "RSL-API-1003": {
    code: "RSL-API-1003",
    httpStatus: 429,
    title: "Too many requests",
    userMessage: "You have sent too many requests in a short window.",
    remediation: "Wait a few seconds and retry using the Retry-After header.",
    docsSlug: "errors/RSL-API-1003",
    retryable: true,
    domain: "api",
  },
  "RSL-SYS-1001": {
    code: "RSL-SYS-1001",
    httpStatus: 500,
    title: "Unexpected issue",
    userMessage: "Something went wrong while completing your request. Your data has not been lost.",
    remediation: "Try again in a moment, or share the Reference ID shown below with support.",
    docsSlug: "errors/RSL-SYS-1001",
    retryable: true,
    domain: "system",
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export class RslError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly remediation: string;
  public readonly docsSlug: string;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, customMessage?: string, details?: Record<string, unknown>) {
    const entry = ERROR_CATALOG[code];
    super(customMessage ?? entry.userMessage);
    this.name = "RslError";
    this.code = code;
    this.httpStatus = entry.httpStatus;
    this.remediation = entry.remediation;
    this.docsSlug = entry.docsSlug;
    this.retryable = entry.retryable;
    this.details = details;
  }

  toPublicObject(correlationId?: string) {
    return {
      code: this.code,
      title: ERROR_CATALOG[this.code].title,
      message: this.message,
      remediation: this.remediation,
      docsSlug: this.docsSlug,
      retryable: this.retryable,
      correlationId,
      details: this.details,
    };
  }
}
