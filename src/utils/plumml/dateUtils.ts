export function toApiDateTime(dateInput: unknown, time = "00:00:00"): string {
  if (!dateInput && dateInput !== 0) return String(dateInput);
  const input = typeof dateInput === "string" ? dateInput.trim() : String(dateInput);

  const normalizeDateTime = (dateStr: string, timeStr: string) => `${dateStr}T${timeStr}`;

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return normalizeDateTime(input, time);
  }

  const isoMatch = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$/.exec(
    input
  );
  if (isoMatch) {
    return normalizeDateTime(isoMatch[1], isoMatch[2]);
  }

  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Could not parse date "${input}". Expected something like 2026-07-10.`);
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `${y}-${m}-${day}T${hours}:${minutes}:${seconds}`;
}
