/**
 * PlumTrips requires dates as 'yyyy-MM-ddTHH:mm:ss' (e.g. "2026-07-10T00:00:00"),
 * but Gemini naturally extracts plain dates like "2026-07-10". This normalizes
 * any reasonable date input into the exact format PlumTrips expects.
 */
function toApiDateTime(dateInput, time = "00:00:00") {
  if (!dateInput) return dateInput;

  const input = typeof dateInput === "string" ? dateInput.trim() : dateInput;

  const normalizeDateTime = (dateStr, timeStr) => {
    return `${dateStr}T${timeStr}`;
  };

  if (typeof input === "string") {
    // Plain yyyy-MM-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return normalizeDateTime(input, time);
    }

    // ISO-like datetime with optional milliseconds and timezone.
    const isoMatch = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$/.exec(input);
    if (isoMatch) {
      return normalizeDateTime(isoMatch[1], isoMatch[2]);
    }
  }

  // Fallback: parse whatever we got and rebuild yyyy-MM-ddTHH:mm:ss manually.
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error(`Could not parse date "${dateInput}". Expected something like 2026-07-10.`);
  }

  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${y}-${m}-${day}T${hours}:${minutes}:${seconds}`;
}

module.exports = { toApiDateTime };
