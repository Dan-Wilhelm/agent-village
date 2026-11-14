/**
 * Calendar feed (Google Apps Script, read-only, live).
 *
 * Returns YOUR upcoming calendar events as JSON — only when called with the
 * secret key. Nothing is copied or stored anywhere: every call reads the
 * calendar live. Deploy as a Web App (Execute as: Me, Who has access: Anyone).
 *
 * Setup:
 *  1. script.google.com → New project → paste this file.
 *  2. Replace PASTE_A_LONG_RANDOM_SECRET below with a long random string
 *     (e.g. from your password manager, 40+ characters).
 *  3. Deploy → New deployment → type "Web app" → Execute as "Me",
 *     Who has access "Anyone" → Deploy → authorize (read your calendar).
 *  4. Copy the Web app URL.
 */
const SECRET = 'PASTE_A_LONG_RANDOM_SECRET';
const MAX_HOURS = 72;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!SECRET || SECRET.indexOf('PASTE_') === 0 || p.key !== SECRET) {
    return json_({ error: 'forbidden' });
  }
  const hours = Math.max(1, Math.min(Number(p.hours) || 24, MAX_HOURS));
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 60 * 1000); // include meetings that started in the last hour
  const until = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const events = CalendarApp.getDefaultCalendar()
    .getEvents(from, until)
    .filter(function (ev) {
      return !ev.isAllDayEvent() && ev.getMyStatus() !== CalendarApp.GuestStatus.NO;
    })
    .map(function (ev) {
      return {
        id: ev.getId(),
        title: ev.getTitle(),
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        attendees: ev.getGuestList().map(function (g) { return g.getEmail(); }),
        description: (ev.getDescription() || '').slice(0, 2000),
      };
    });

  return json_({ generatedAt: now.toISOString(), events: events });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
