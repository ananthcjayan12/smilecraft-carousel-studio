CREATE TABLE IF NOT EXISTS admin_credit_adjustments (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 admin_user_id TEXT NOT NULL,
 admin_email TEXT NOT NULL,
 mode TEXT NOT NULL,
 amount INTEGER NOT NULL,
 before_balance INTEGER NOT NULL,
 after_balance INTEGER NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS admin_credit_adjustments_account ON admin_credit_adjustments(account_id,created_at);
