CREATE UNIQUE INDEX `doc_req_token_idx` ON `document_requests` (`magic_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_pay_token_idx` ON `invoices` (`pay_token`);