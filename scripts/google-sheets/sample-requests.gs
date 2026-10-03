/**
 * Srshti free-carousel requests → this Google Sheet.
 *
 * 1. Extensions → Apps Script, paste this file, save.
 * 2. Project Settings → Script properties → add SECRET = (the same long random value you give the website).
 * 3. Run `setup` once (approve the permission prompt). It adds and formats the header row.
 * 4. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → Deploy.
 *    Give the /exec URL to the website as SHEETS_WEBHOOK_URL.
 */
const SHEET_NAME = 'Sample requests';
const HEADERS = ['Submitted at', 'Name', 'Clinic name', 'Email', 'Instagram', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM content', 'Status', 'Notes'];
const STATUSES = ['New', 'Contacted', 'Sample sent', 'Demo booked', 'Customer', 'Not a fit'];

function sheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  return book.getSheetByName(SHEET_NAME) || book.getSheets()[0].setName(SHEET_NAME);
}

function setup() {
  const sheet = sheet_();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#efedff').setFontColor('#202339');
  sheet.setFrozenRows(1);
  [170, 160, 200, 230, 170, 110, 110, 140, 120, 120, 260].forEach((width, i) => sheet.setColumnWidth(i + 1, width));
  sheet.getRange(2, 10, sheet.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(event.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorised' });
    if (!Array.isArray(body.row) || body.row.length !== HEADERS.length - 1) return json_({ ok: false, error: 'bad row' });
    lock.waitLock(10000);
    sheet_().appendRow(body.row.map(value => String(value).slice(0, 500)).concat(['']));
    return json_({ ok: true });
  } catch (error) {
    return json_({ ok: false, error: 'failed' });
  } finally {
    lock.releaseLock();
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
