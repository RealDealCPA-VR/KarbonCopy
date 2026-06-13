CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`verb` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activities_entity_idx` ON `activities` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE TABLE `automators` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger` text NOT NULL,
	`conditions` text,
	`action` text NOT NULL,
	`action_params` text,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `client_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`mentions` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_entity_idx` ON `comments` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`title` text,
	`organization_id` text,
	`ssn_last4` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`portal_enabled` integer DEFAULT false NOT NULL,
	`notes` text,
	`owner_id` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_name_idx` ON `contacts` (`last_name`,`first_name`);--> statement-breakpoint
CREATE INDEX `contacts_org_idx` ON `contacts` (`organization_id`);--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`field_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`value` text,
	FOREIGN KEY (`field_id`) REFERENCES `custom_fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cfv_field_entity_idx` ON `custom_field_values` (`field_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_kind` text NOT NULL,
	`label` text NOT NULL,
	`field_type` text DEFAULT 'text' NOT NULL,
	`options` text,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`organization_id` text,
	`contact_id` text,
	`work_item_id` text,
	`items` text,
	`status` text DEFAULT 'open' NOT NULL,
	`magic_token` text NOT NULL,
	`expires_at` integer,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`folder_id` text,
	`organization_id` text,
	`work_item_id` text,
	`storage_path` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`uploaded_by_id` text,
	`source` text DEFAULT 'upload' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `docs_org_idx` ON `documents` (`organization_id`);--> statement-breakpoint
CREATE TABLE `entity_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_tags_idx` ON `entity_tags` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE TABLE `file_events` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text,
	`rule_id` text,
	`event` text NOT NULL,
	`file_path` text NOT NULL,
	`file_name` text NOT NULL,
	`size_bytes` integer,
	`organization_id` text,
	`work_item_id` text,
	`status` text DEFAULT 'new' NOT NULL,
	`acknowledged_by_id` text,
	`acknowledged_at` integer,
	`detected_at` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `watched_roots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rule_id`) REFERENCES `file_rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`acknowledged_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `file_events_status_idx` ON `file_events` (`status`);--> statement-breakpoint
CREATE INDEX `file_events_detected_idx` ON `file_events` (`detected_at`);--> statement-breakpoint
CREATE TABLE `file_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`glob_pattern` text NOT NULL,
	`event` text DEFAULT 'add' NOT NULL,
	`notify` text,
	`message` text,
	`severity` text DEFAULT 'success' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `watched_roots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`organization_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inbox_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_id` text,
	`organization_id` text,
	`contact_id` text,
	`work_item_id` text,
	`last_message_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`from_name` text,
	`from_email` text,
	`to_email` text,
	`body` text NOT NULL,
	`direction` text DEFAULT 'inbound' NOT NULL,
	`sent_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `inbox_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`entity_kind` text,
	`entity_id` text,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notif_user_read_idx` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`entity_type` text DEFAULT 'c_corp' NOT NULL,
	`ein` text,
	`website` text,
	`phone` text,
	`email` text,
	`address` text,
	`fiscal_year_end` text,
	`notes` text,
	`owner_id` text,
	`client_group_id` text,
	`is_client` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orgs_name_idx` ON `organizations` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `template_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`section` text,
	`position` integer DEFAULT 0 NOT NULL,
	`due_offset_days` integer,
	FOREIGN KEY (`template_id`) REFERENCES `work_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`work_item_id` text,
	`organization_id` text,
	`description` text,
	`minutes` integer DEFAULT 0 NOT NULL,
	`billable` integer DEFAULT true NOT NULL,
	`rate_cents` integer,
	`date` integer NOT NULL,
	`started_at` integer,
	`running` integer DEFAULT false NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `time_user_date_idx` ON `time_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `time_work_idx` ON `time_entries` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`image` text,
	`role` text DEFAULT 'staff' NOT NULL,
	`title` text,
	`team_id` text,
	`weekly_capacity_minutes` integer DEFAULT 2400 NOT NULL,
	`color` text,
	`active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `watched_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`match_org_by_folder` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`work_type_id` text,
	`status_id` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`organization_id` text,
	`contact_id` text,
	`assignee_id` text,
	`team_id` text,
	`start_date` integer,
	`due_date` integer,
	`completed_at` integer,
	`budget_minutes` integer,
	`budget_amount_cents` integer,
	`board_position` real DEFAULT 0 NOT NULL,
	`recurrence_rule` text,
	`template_id` text,
	`file_folder_path` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`work_type_id`) REFERENCES `work_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `work_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_status_idx` ON `work_items` (`status_id`);--> statement-breakpoint
CREATE INDEX `work_assignee_idx` ON `work_items` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `work_org_idx` ON `work_items` (`organization_id`);--> statement-breakpoint
CREATE INDEX `work_due_idx` ON `work_items` (`due_date`);--> statement-breakpoint
CREATE TABLE `work_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'todo' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`color` text,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`title` text NOT NULL,
	`section` text,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`completed_by_id` text,
	`assignee_id` text,
	`due_date` integer,
	`depends_on_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`completed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_work_idx` ON `work_tasks` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `work_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`work_type_id` text,
	`default_budget_minutes` integer,
	`recurrence_rule` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`work_type_id`) REFERENCES `work_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`default_budget_minutes` integer,
	`created_at` integer NOT NULL
);
