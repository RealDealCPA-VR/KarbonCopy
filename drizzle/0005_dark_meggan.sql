CREATE UNIQUE INDEX `portal_sessions_token_unique` ON `portal_sessions` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);