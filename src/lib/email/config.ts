/**
 * Shared types for email account configuration.
 *
 * The firm enters SMTP/IMAP (or, in future, Gmail/Graph) credentials in Settings.
 * The *credential payload* is serialized to JSON and stored encrypted in
 * `emailAccounts.configEnc` via `lib/crypto`. Only the encrypted blob ever touches
 * the database; raw creds must never be returned to the client.
 */

export type EmailProvider = "smtp_imap" | "gmail" | "graph";

/** Credentials for a classic SMTP-send + IMAP-receive mailbox. */
export interface SmtpImapConfig {
  kind: "smtp_imap";
  smtp: {
    host: string;
    port: number;
    secure: boolean; // true => TLS on connect (465); false => STARTTLS (587)
    user: string;
    pass: string;
  };
  imap: {
    host: string;
    port: number;
    secure: boolean; // true => implicit TLS (993)
    user: string;
    pass: string;
    /** Mailbox to poll for inbound mail. Defaults to "INBOX". */
    mailbox?: string;
  };
}

/** Placeholder for future OAuth-based providers (not implemented yet). */
export interface OAuthEmailConfig {
  kind: "gmail" | "graph";
  oauth: Record<string, unknown>;
}

export type EmailConfig = SmtpImapConfig | OAuthEmailConfig;

export function isSmtpImap(cfg: EmailConfig | null | undefined): cfg is SmtpImapConfig {
  return !!cfg && cfg.kind === "smtp_imap";
}

/**
 * Public, credential-free view of an account safe to send to the browser.
 * Host/port/user are shown so admins can confirm what's configured; passwords
 * are reduced to a boolean "is set" flag.
 */
export interface SafeEmailAccount {
  id: string;
  label: string;
  address: string;
  provider: EmailProvider;
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  createdAt: number;
  configured: boolean; // configEnc present + decryptable
  smtp?: { host: string; port: number; secure: boolean; user: string; hasPass: boolean };
  imap?: { host: string; port: number; secure: boolean; user: string; hasPass: boolean; mailbox: string };
}
