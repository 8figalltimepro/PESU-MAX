import { CALENDAR } from "./calendarData.js";

export { CALENDAR };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 24 * 60 * 60 * 1000;

export const CALENDAR_VISIBLE_COUNT = 6;

const TYPE_LABELS = {
  holiday: "Holiday",
  assessment: "Assessment",
  meeting: "Meeting",
  academic: "Academic",
  deadline: "Deadline"
};

const parseDate = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const sameDay = (a, b) =>
  a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const calendarTypeLabel = (type) => TYPE_LABELS[type] || "Academic";

export const calendarEventStart = (event) => parseDate(event.start);

export const calendarEventEnd = (event) => parseDate(event.end);

export function upcomingCalendarEvents(now = new Date()) {
  const today = startOfDay(now);
  return CALENDAR.events
    .filter((event) => {
      const end = calendarEventEnd(event);
      return end && end >= today;
    })
    .sort((left, right) => {
      const byStart = calendarEventStart(left) - calendarEventStart(right);
      if (byStart !== 0) return byStart;
      return left.title.localeCompare(right.title);
    });
}

export function calendarRelativeLabel(event, now = new Date()) {
  const today = startOfDay(now);
  const start = calendarEventStart(event);
  const end = calendarEventEnd(event);
  if (!start || !end) return "";

  if (start <= today && end >= today) {
    return sameDay(start, today) ? "Today" : "Ongoing";
  }

  const days = Math.round((start - today) / DAY_MS);
  if (days === 1) return "Tomorrow";
  if (days > 1 && days <= 7) return `In ${days} days`;
  return "";
}

export function calendarEventDate(event, now = new Date()) {
  const start = calendarEventStart(event);
  const end = calendarEventEnd(event);
  if (!start || !end) return "";
  const currentYear = now.getFullYear();
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  if (!sameDay(start, end)) {
    if (start.getMonth() === end.getMonth() && startYear === endYear) {
      return `${start.getDate()}–${end.getDate()} ${MONTHS[start.getMonth()]}${startYear !== currentYear ? ` ${startYear}` : ""}`;
    }
    return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]}${endYear !== currentYear ? ` ${endYear}` : ""}`;
  }

  const weekday = WEEKDAYS[start.getDay()];
  return `${weekday}, ${start.getDate()} ${MONTHS[start.getMonth()]}${startYear !== currentYear ? ` ${startYear}` : ""}`;
}

export function calendarDateParts(event, now = new Date()) {
  const start = calendarEventStart(event);
  const end = calendarEventEnd(event);
  if (!start || !end) return { month: "", day: "", year: "", range: false };
  return {
    month: MONTHS[start.getMonth()].toUpperCase(),
    day: sameDay(start, end) ? String(start.getDate()) : `${start.getDate()}–${end.getDate()}`,
    year: start.getFullYear() !== now.getFullYear() ? String(start.getFullYear()) : "",
    range: !sameDay(start, end)
  };
}

export function calendarEventWeekday(event) {
  const start = calendarEventStart(event);
  const end = calendarEventEnd(event);
  if (!start || !end) return "";
  if (sameDay(start, end)) return WEEKDAYS_FULL[start.getDay()];

  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > 7) return "";
  return `${WEEKDAYS_FULL[start.getDay()]}–${WEEKDAYS_FULL[end.getDay()]}`;
}
