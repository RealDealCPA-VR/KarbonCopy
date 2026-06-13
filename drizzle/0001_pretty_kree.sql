CREATE TABLE `anomalies` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`source` text DEFAULT 'quickbooks' NOT NULL,
	`kind` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`amount_cents` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`detected_at` integer NOT NULL,
	`reviewed_by_id` text,
	`meta` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `anomalies_org_idx` ON `anomalies` (`organization_id`);--> statement-breakpoint
CREATE INDEX `anomalies_status_idx` ON `anomalies` (`status`);--> statement-breakpoint
CREATE TABLE `compliance_deadlines` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`jurisdiction` text DEFAULT 'federal' NOT NULL,
	`form` text,
	`tax_period` text,
	`due_date` integer NOT NULL,
	`extended_due_date` integer,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`work_item_id` text,
	`rule_key` text,
	`auto_generated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deadlines_due_idx` ON `compliance_deadlines` (`due_date`);--> statement-breakpoint
CREATE INDEX `deadlines_org_idx` ON `compliance_deadlines` (`organization_id`);--> statement-breakpoint
CREATE TABLE `document_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text,
	`file_event_id` text,
	`organization_id` text,
	`source_path` text NOT NULL,
	`doc_type` text,
	`confidence` real,
	`extracted_fields` text,
	`ocr_text` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`matched_request_id` text,
	`matched_work_item_id` text,
	`engine` text,
	`error` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`file_event_id`) REFERENCES `file_events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_request_id`) REFERENCES `document_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `extractions_status_idx` ON `document_extractions` (`status`);--> statement-breakpoint
CREATE TABLE `email_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`address` text NOT NULL,
	`provider` text DEFAULT 'smtp_imap' NOT NULL,
	`config_enc` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`config` text,
	`enabled` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'unconfigured' NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_cents` integer DEFAULT 0 NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`work_item_id` text,
	`time_entry_ids` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` integer,
	`due_date` integer,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`amount_paid_cents` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`notes` text,
	`terms` text,
	`pay_token` text,
	`sent_at` integer,
	`paid_at` integer,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoices_org_idx` ON `invoices` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_idx` ON `invoices` (`number`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text,
	`organization_id` text,
	`amount_cents` integer NOT NULL,
	`method` text DEFAULT 'manual' NOT NULL,
	`reference` text,
	`processor` text DEFAULT 'manual' NOT NULL,
	`processor_ref` text,
	`received_at` integer NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `portal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`portal_user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`portal_user_id`) REFERENCES `portal_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `portal_users` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`invite_token` text,
	`invite_expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_users_email_idx` ON `portal_users` (`email`);--> statement-breakpoint
CREATE INDEX `portal_users_contact_idx` ON `portal_users` (`contact_id`);--> statement-breakpoint
CREATE TABLE `signature_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_name` text,
	`ip` text,
	`user_agent` text,
	`hash` text,
	`meta` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `signature_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sig_events_req_idx` ON `signature_events` (`request_id`);--> statement-breakpoint
CREATE TABLE `signature_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`document_id` text,
	`work_item_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`magic_token` text NOT NULL,
	`message` text,
	`fields` text,
	`signed_document_path` text,
	`signer_name` text,
	`expires_at` integer,
	`created_by_id` text,
	`signed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sig_token_idx` ON `signature_requests` (`magic_token`);--> statement-breakpoint
ALTER TABLE `messages` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `account_id` text;