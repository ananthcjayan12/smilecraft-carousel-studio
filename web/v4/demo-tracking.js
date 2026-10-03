export function validatedCalendarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'calendly.com' &&
      !url.username && !url.password && url.pathname.split('/').filter(Boolean).length >= 2 ? url : null;
  } catch { return null; }
}

export function confirmedBooking(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== 'https://calendly.com' ||
      event.data?.event !== 'calendly.event_scheduled') return null;
  try {
    const uri = new URL(event.data.payload?.event?.uri);
    return uri.origin === 'https://api.calendly.com' && /^\/scheduled_events\/[^/]+$/.test(uri.pathname) ? uri.href : null;
  } catch { return null; }
}
