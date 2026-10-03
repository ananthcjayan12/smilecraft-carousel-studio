import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {validatedCalendarUrl,confirmedBooking} from '../web/v4/demo-tracking.js';

test('only actual Calendly event URLs can become booking destinations',()=>{
  assert.ok(validatedCalendarUrl('https://calendly.com/practice/dental-demo'));
  for(const value of ['', 'javascript:alert(1)', 'https://calendly.com.evil.test/a/b', 'https://calendly.com/', 'https://user:password@calendly.com/a/b']) assert.equal(validatedCalendarUrl(value),null);
});

test('booking measurement rejects spoofed messages and incomplete appointments',()=>{
  const source={},uri='https://api.calendly.com/scheduled_events/booking-123';
  const message={source,origin:'https://calendly.com',data:{event:'calendly.event_scheduled',payload:{event:{uri}}}};
  assert.equal(confirmedBooking(message,source),uri);
  assert.equal(confirmedBooking({...message,source:{}},source),null);
  assert.equal(confirmedBooking({...message,origin:'https://evil.test'},source),null);
  assert.equal(confirmedBooking({...message,data:{event:'calendly.date_and_time_selected'}},source),null);
  assert.equal(confirmedBooking({...message,data:{event:'calendly.event_scheduled',payload:{event:{uri:'https://evil.test/booking'}}}},source),null);
  assert.equal(confirmedBooking(message,undefined),null);
});

test('the new credit offer preserves existing subscribed plans and is idempotent',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(readFileSync('cloudflare/migrations/0001_accounts_credits.sql','utf8'));
    db.exec(readFileSync('cloudflare/migrations/0010_v4_manual_clinic_plan.sql','utf8'));
    db.exec("INSERT INTO accounts(id,name) VALUES('existing','Existing practice'); INSERT INTO subscriptions(account_id,plan_id,plan_version,status) VALUES('existing','founding-clinic',1,'manual');");
    const migration=readFileSync('cloudflare/migrations/0013_weekly_content_plan.sql','utf8');db.exec(migration);db.exec(migration);
    assert.equal(db.prepare("SELECT monthly_credits FROM plans WHERE id='weekly-content'").get().monthly_credits,1000);
    assert.equal(db.prepare("SELECT plan_id FROM subscriptions WHERE account_id='existing'").get().plan_id,'founding-clinic');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plans WHERE id='weekly-content'").get().n,1);
  } finally { db.close(); }
});
