const TARGET_PATH = "/timetable/my-";
const EMOJI_CLASS = "until_emoji_lesson_timetable";
const ext = globalThis.browser ?? globalThis.chrome;

// The defaults a school can change are in variables.js
const DEFAULT_EMOJI = VARIABLES.defaultEmoji;
const DEFAULT_SETTINGS = { ...VARIABLES.switches };
const DEFAULT_TIMES = Object.fromEntries(
  Object.entries(VARIABLES.minutes).map(([key, field]) => [key, field.default]),
);

const settings = { ...DEFAULT_SETTINGS };
const times = { ...DEFAULT_TIMES };

ext.storage.local.get(DEFAULT_SETTINGS).then((data) => {
  Object.assign(settings, data);
});

ext.storage.local.get(DEFAULT_TIMES).then((data) => {
  Object.assign(times, data);
});

// Every school's WebUntis lives at <server>.webuntis.com/WebUntis/...
const untis = ky.create({ baseUrl: "/WebUntis/" });

// Runs fn once and shares the result, forgets it on errors and after maxAge ms
function cached(fn, maxAge = Infinity) {
  let promise = null;
  let expires = 0;
  return (...args) => {
    if (!promise || Date.now() > expires) {
      expires = Date.now() + maxAge;
      promise = fn(...args).catch((e) => {
        promise = null;
        throw e;
      });
    }
    return promise;
  };
}

// ---------- School name ----------
// JSON RPC needs the school name, so try the places where it usually shows up
const SCHOOL_KEY = `school:${location.host}`;
let school = null;

// The login page URL often has ?school=..., so remember it for after the login
const schoolInUrl = new URLSearchParams(location.search).get("school");
if (schoolInUrl) ext.storage.local.set({ [SCHOOL_KEY]: schoolInUrl });

// The time of the last change in WebUntis, also finds the school name. null if no name works
async function getLatestImportTime() {
  const saved = (await ext.storage.local.get(SCHOOL_KEY))[SCHOOL_KEY];
  const candidates = [
    school, // worked on this page already
    saved, // worked last time, or came from the login page
    schoolInUrl,
    location.hostname.split(".")[0],
  ];

  for (const name of new Set(candidates)) {
    if (!name) continue;
    try {
      const time = await rpcWithSchool(name, "getLatestImportTime");
      school = name;
      if (name !== saved) await ext.storage.local.set({ [SCHOOL_KEY]: name });
      return time;
    } catch {
      // wrong name, try the next one
    }
  }
  return null;
}

async function rpcWithSchool(schoolName, method, params = {}) {
  const body = await untis
    .post("jsonrpc.do", {
      searchParams: { school: schoolName },
      json: { id: "until-webuntis", method, params, jsonrpc: "2.0" },
    })
    .json();
  if (body.error) throw new Error(body.error.message); // errors still come with status 200
  if (body.result?.code) throw new Error(`Error code ${body.result.code}`);
  return body.result;
}

// ---------- Login ----------
// The REST API needs a token. One is valid for 15 minutes, so reuse it for 14.
const getToken = cached(
  async () => {
    // ky's .text() would send "Accept: text/*" and WebUntis answers that with a 500
    const token = (
      await untis.get("api/token/new", { headers: { Accept: "*/*" } }).text()
    ).trim();
    // logged out = redirect to the login page (still 200), so no JWT
    if (!token.startsWith("eyJ") || token.split(".").length !== 3) {
      throw new Error("Not logged in");
    }
    return token;
  },
  14 * 60 * 1000,
);

async function authHeader() {
  return { Authorization: `Bearer ${await getToken()}` };
}

function isLoggedIn() {
  return getToken().then(
    () => true,
    () => false,
  );
}

const getUser = cached(async () => {
  const config = await untis.get("api/app/config").json();
  const user = config.data.loginServiceConfig.user;
  return {
    userId: user.personId,
    userType: user.persons.find((p) => p.id === user.personId).type,
  };
});

// ---------- Timetables WebUntis loads itself ---------
// inject.js passes on every timetable the page loads, so there's no need to fetch our own again
const pageTimetables = new Map();
const waiting = new Map(); // same key, value is resolve() of waitForPageTimetable

function timetableKey(resourceType, resourceId, week) {
  return `${resourceType}-${resourceId}-${week.start}`;
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "until-webuntis")
    return;
  const params = new URL(event.data.url, location.href).searchParams;
  const key = timetableKey(
    params.get("resourceType"),
    params.get("resources"),
    { start: params.get("start") },
  );
  pageTimetables.set(key, event.data.days);
  waiting.get(key)?.(event.data.days);
  waiting.delete(key);
});

// Waits for the timetable WebUntis loads itself, null if it doesn't come in time
function waitForPageTimetable(key, ms) {
  if (pageTimetables.has(key)) return Promise.resolve(pageTimetables.get(key));
  return new Promise((resolve) => {
    waiting.set(key, resolve);
    setTimeout(() => resolve(null), ms);
  });
}

// ---------- Emoji ----------
let emoji = DEFAULT_EMOJI;
let marked = []; // the lessons that get the emoji

ext.storage.local.get({ emoji: DEFAULT_EMOJI }).then((data) => {
  emoji = data.emoji || DEFAULT_EMOJI; // "" when the field in the popup was emptied
});

// New emoji chosen in the popup, swap it right away
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.emoji) {
    emoji = changes.emoji.newValue || DEFAULT_EMOJI;
  } else if (
    changes.notification ||
    changes.alert ||
    changes.lesson ||
    changes.taskbar
  ) {
    for (const key in changes) {
      if (key in settings) settings[key] = changes[key].newValue;
    }
    // Only take the emojis off the page, keep `marked` so turning it on again works
    if (!settings["lesson"]) {
      document
        .querySelectorAll(`.${EMOJI_CLASS}`)
        .forEach((span) => span.remove());
    }
  } else if (changes.remindMinutes || changes.showMinutes) {
    for (const key in changes) {
      if (key in times) times[key] = changes[key].newValue;
    }
  }
  showEmojis(); // so turning "lesson" on or off takes effect right away
});

function setMarked(lessons) {
  marked = lessons;
  document.querySelectorAll(`.${EMOJI_CLASS}`).forEach((span) => span.remove());
  showEmojis();
}

// Safe to call any time: only adds what's missing
function showEmojis() {
  showEmojiSidebar();
  if (!settings["lesson"]) return;
  for (const lesson of marked) {
    const resource = document.querySelector(
      `.lesson-card[data-testid$="-${lesson.id}"] [data-testid="regular-resource"]`,
    );
    if (!resource) continue;

    let span = resource.querySelector(`.${EMOJI_CLASS}`);
    if (!span) {
      span = document.createElement("span");
      span.classList.add(EMOJI_CLASS);

      span.style.cssText =
        "position:absolute; color:red; white-space:nowrap; right: 7px; top: 7px; font-size: 1.3rem;";
      resource.appendChild(span);
    }
    if (span.textContent !== emoji) span.textContent = emoji;

    // Checked every time, so the glow starts and stops while the page stays open
    const glow = isEndingSoon(lesson);
    if (span.dataset.glow !== String(glow)) {
      span.dataset.glow = glow;
      span.style.textShadow = glow ? `0 0 15px ${VARIABLES.glowColor}` : "";
    }
  }
}

// ---------- Main ----------
// WebUntis changes the URL without reloading the page, so check it regularly
let lastPage = null;
let running = false;

setInterval(() => {
  showEmojis(); // WebUntis draws its cards late and sometimes again, so put the emoji back
  checkPage();
  showReminder();
  showEmojiSidebar();
}, 500);

// Logged out (e.g. on the login page): don't ask WebUntis every 500 ms, only every 30 s
let loggedOutUntil = 0;

async function showReminder() {
  if (settings["alert"] === false && settings["notification"] === false) return;

  if (Date.now() < loggedOutUntil) return;
  if (!(await isLoggedIn())) {
    loggedOutUntil = Date.now() + 30 * 1000;
    return;
  }

  const lessons = await getThisWeeksChairLessons();
  const today = Number(
    new Date().toLocaleDateString("sv-SE").replaceAll("-", ""),
  );
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (t) => Math.floor(t / 100) * 60 + (t % 100);

  const todaysLesson = lessons.find(
    (l) => l.date === today && isReminderTime(toMinutes(l.end), nowMinutes),
  );
  if (!todaysLesson) return;

  if (settings["alert"]) showAlert(todaysLesson);
  if (settings["notification"]) showNotification(todaysLesson);
}

// From remindMinutes before the end until the end itself, so 0 means "when it ends"
function isReminderTime(endMinutes, nowMinutes) {
  return (
    nowMinutes >= endMinutes - times["remindMinutes"] &&
    nowMinutes <= endMinutes
  );
}

let alertFor = null;

function showAlert(todaysLesson) {
  if (alertFor === todaysLesson.id) return;
  alertFor = todaysLesson.id;
  alert(fillText(getText("alert"), getPlaceholders(todaysLesson)));
}

let notifiedFor = null;

function showNotification(todaysLesson) {
  if (notifiedFor === todaysLesson.id) return;
  notifiedFor = todaysLesson.id;

  const values = getPlaceholders(todaysLesson);

  ext.runtime.sendMessage({
    type: "showNotification",
    title: fillText(getText("notificationTitle"), values),
    text: fillText(getText("notification"), values),
  });
}

// ---------- Texts ----------
// The texts themselves are in variables.js

// One text in the browser's language, or in the fallback language if it's missing
function getText(name) {
  const language = ext.i18n.getUILanguage().split("-")[0]; // "de-AT" becomes "de"
  return (
    VARIABLES.texts[language]?.[name] ??
    VARIABLES.texts[VARIABLES.fallbackLanguage][name]
  );
}

// Everything the texts in variables.js can use as {placeholder}
function getPlaceholders(lesson) {
  const time = (t) =>
    t == null
      ? "?"
      : `${String(Math.floor(t / 100)).padStart(2, "0")}:${String(t % 100).padStart(2, "0")}`;

  const now = new Date();
  const endMinutes = Math.floor(lesson.end / 100) * 60 + (lesson.end % 100);

  return {
    emoji,
    room: lesson.room ?? "?",
    subject: lesson.subject ?? "?",
    teacher: lesson.teacher ?? "?",
    class: lesson.class ?? "?",
    start: time(lesson.start),
    end: time(lesson.end),
    minutesLeft: endMinutes - (now.getHours() * 60 + now.getMinutes()),
  };
}

// Puts the values into the {placeholders}, unknown ones stay as they are
function fillText(text, values) {
  const joined = Array.isArray(text) ? text.join("\n") : text;
  return joined.replace(
    /\{(\w+)\}/g,
    (placeholder, name) => values[name] ?? placeholder,
  );
}

// True if the lesson is today and ends within the next showMinutes minutes (0 = never)
function isEndingSoon(lesson) {
  const now = new Date();

  const nowDate =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const end = Number(lesson["end"]);
  const endMinutes = Math.floor(end / 100) * 60 + (end % 100);

  return (
    nowDate == lesson["date"] &&
    nowMinutes >= endMinutes - times["showMinutes"] &&
    nowMinutes < endMinutes
  );
}

async function showEmojiSidebar() {
  const wrapper = document.querySelector(".untis-menu-header--main .wrapper");
  if (settings["taskbar"]) {
    if (wrapper) {
      // This week's lessons, so the glow also works while browsing other weeks
      let lessons = [];
      try {
        lessons = await getThisWeeksChairLessons();
      } catch {}
      const glow = lessons.some(isEndingSoon);

      // Keep only one emoji, remove leftovers from older versions of the script
      const [first, ...extra] = wrapper.querySelectorAll(
        ".until_sidebar_emoji",
      );
      extra.forEach((span) => span.remove());

      let sidebarEmoji = first;
      if (!sidebarEmoji) {
        sidebarEmoji = document.createElement("span");
        sidebarEmoji.classList.add("until_sidebar_emoji");
        wrapper.appendChild(sidebarEmoji);
      }

      // Set the style every time, so an emoji created by an older version gets it too
      wrapper.style.position = "relative";
      sidebarEmoji.style.cssText =
        "position:absolute; right:10px; top:15px; transform:none; line-height:1; font-size:1.5rem; font-weight:bold; z-index:9999;";
      sidebarEmoji.style.textShadow = glow
        ? `0 0 10px ${VARIABLES.glowColor}`
        : "";
      if (sidebarEmoji.textContent !== emoji) sidebarEmoji.textContent = emoji;
    }
  } else {
    if (wrapper) {
      wrapper
        .querySelectorAll(".until_sidebar_emoji")
        .forEach((span) => span.remove());
    }
  }
}

async function checkPage() {
  if (running) return;

  const date = new URLSearchParams(location.search).get("date");
  const week = getWeek(date ? new Date(`${date}T00:00`) : new Date());
  const page = `${location.pathname} ${week.start}`;
  if (page === lastPage) return;

  running = true;
  try {
    lastPage = page;
    setMarked([]);

    if (!location.pathname.startsWith(TARGET_PATH)) return;
    if (!(await isLoggedIn())) return;
    await update(week);
  } catch (e) {
    console.error(e);
  } finally {
    running = false;
  }
}

async function update(week) {
  // userId in the key, so two students on the same laptop don't mix up their data
  const { userId, userType } = await getUser();
  const key = `chairs:${location.host}:${userId}:${week.start}`;
  const saved = (await ext.storage.local.get(key))[key];

  // Show the saved result right away
  if (saved) setMarked(saved.lessons);

  // Only work it out again if something changed in WebUntis
  const importTime = await getLatestImportTime();
  if (saved && importTime && saved.importTime === importTime) return;

  const lessons = await getChairLessons(week, userId, userType);
  setMarked(lessons);
  await ext.storage.local.set({ [key]: { importTime, lessons } });
}

// This week's chair lessons (not the week you're looking at), for the reminders.
const getThisWeeksChairLessons = cached(
  async () => {
    const { userId, userType } = await getUser();
    return getChairLessons(getWeek(new Date()), userId, userType);
  },
  5 * 60 * 1000,
);

// Every lesson where nobody else uses its room after us on that day
async function getChairLessons(week, userId, userType) {
  const resourceType = RESOURCE_TYPES[userType];

  // WebUntis loads your timetable too, so use its answer, or fetch it
  const myDays =
    (await waitForPageTimetable(
      timetableKey(resourceType, userId, week),
      3000,
    )) ?? (await getTimetable(resourceType, userId, week, "MY_TIMETABLE"));
  const roomIds = await getRoomIds(week);
  const myLessons = toLessons(myDays, roomIds);

  // each room only once, even if we have several lessons in it
  const usedRooms = [
    ...new Set(myLessons.map((l) => l.roomId).filter(Boolean)),
  ];
  const roomLessons = {};
  await Promise.all(
    usedRooms.map(async (roomId) => {
      roomLessons[roomId] = toLessons(
        await getTimetable("ROOM", roomId, week, "STANDARD"),
      );
    }),
  );

  return myLessons.filter((lesson) => {
    if (!lesson.roomId) {
      console.warn("No room found for lesson", lesson);
      return false;
    }
    const sameDay = roomLessons[lesson.roomId].filter(
      (l) => l.date === lesson.date,
    );
    const [lastInRoom] = getLastLesson(sameDay);
    // nobody uses the room after us, so we're the last ones in it
    return lastInRoom?.end === lesson.end;
  });
}

// ---------- Timetable ----------
// Element types from api/app/config mapped to resource types of the REST timetable API
const RESOURCE_TYPES = { 1: "CLASS", 2: "TEACHER", 4: "ROOM", 5: "STUDENT" };

function getWeek(date) {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // getDay(): Sunday = 0
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    start: monday.toLocaleDateString("sv-SE"),
    end: friday.toLocaleDateString("sv-SE"),
  };
}

// The week as a sorted list without cancelled lessons, `id` is the last period of a double lesson
function toLessons(days, roomIds = {}) {
  return days
    .flatMap((day) => day.gridEntries)
    .filter((l) => l.status !== "CANCELLED")
    .map((l) => ({
      id: l.ids.at(-1),
      date: Number(l.duration.start.slice(0, 10).replaceAll("-", "")),
      start: Number(l.duration.start.slice(11).replace(":", "")),
      end: Number(l.duration.end.slice(11).replace(":", "")),
      roomId: roomIds[getName(l, "ROOM")],
      room: getName(l, "ROOM"),
      subject: getName(l, "SUBJECT"),
      teacher: getName(l, "TEACHER"),
      class: getName(l, "CLASS"),
    }))
    .sort((a, b) => a.date - b.date || a.end - b.end);
}

// The short name of the lesson's room, subject, teacher or class, undefined if it has none
function getName(lesson, type) {
  for (let i = 1; i <= 7; i++) {
    const entry = lesson[`position${i}`]?.find((p) => p.current?.type === type);
    if (entry) return entry.current.shortName;
  }
}

function getLastLesson(lessons) {
  const lastByDay = {};
  lessons.forEach((lesson) => {
    const last = lastByDay[lesson.date];
    if (!last || lesson.end > last.end) lastByDay[lesson.date] = lesson;
  });
  return Object.values(lastByDay); // number keys are already sorted by date
}

// The REST API WebUntis' own timetable page uses (the old weekly/data API leaves out Mondays)
async function getTimetable(resourceType, resourceId, week, timetableType) {
  // WebUntis loaded it already (e.g. you looked at that room), no request needed
  const fromPage = pageTimetables.get(
    timetableKey(resourceType, resourceId, week),
  );
  if (fromPage) return fromPage;

  const body = await untis
    .get("api/rest/view/v1/timetable/entries", {
      headers: await authHeader(),
      searchParams: {
        start: week.start,
        end: week.end,
        format: 8,
        resourceType,
        resources: resourceId,
        periodTypes: "",
        timetableType, // "MY_TIMETABLE" for your own, "STANDARD" for rooms, classes, ...
        layout: "START_TIME",
      },
    })
    .json();
  return body.days;
}

// The timetable only has room names, so look up their IDs once
const getRoomIds = cached(async (week) => {
  const body = await untis
    .get("api/rest/view/v1/timetable/filter", {
      headers: await authHeader(),
      searchParams: {
        resourceType: "ROOM",
        timetableType: "STANDARD",
        start: week.start,
        end: week.end,
      },
    })
    .json();
  return Object.fromEntries(
    body.rooms.map((r) => [r.room.shortName, r.room.id]),
  );
});
