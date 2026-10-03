-- Keep existing subscriptions intact; new activations use this single offer.
INSERT OR IGNORE INTO plans(id,version,monthly_credits)
VALUES ('weekly-content',1,1000);
