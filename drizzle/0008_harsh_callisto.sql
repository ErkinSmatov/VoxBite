-- This column held LIVE data at drop time: any diary_drafts row that was
-- mid-correction through the old chat-native flow (D-04) could have a
-- non-null awaiting_input value. That data is intentionally discarded here
-- -- the Telegram Mini App (phase 04.1) has no equivalent concept and does
-- not read this column. No backfill is needed: per D-11, unconfirmed drafts
-- expire after 24 hours, so any pre-cutover draft still mid-correction is
-- short-lived and will already be stale well before this migration runs.
ALTER TABLE "diary_drafts" DROP COLUMN "awaiting_input";