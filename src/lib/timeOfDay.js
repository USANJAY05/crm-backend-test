// Return a stable time-of-day label for a specific IANA timezone.
// Never derive a business/caller-local hour by adding a fixed UTC offset:
// fixed offsets break as soon as the timezone has DST or the process timezone changes.
function getTimeOfDay(date = new Date(), timeZone = "Asia/Kolkata") {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).format(date));
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 16) return "afternoon";
  if (hour >= 16 && hour < 20) return "evening";
  return "night";
}

module.exports = { getTimeOfDay };
