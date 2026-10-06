// Everything a school can change to make Until its own.
// A longer explanation with examples is in SCHOOL_SETUP.md.
//
// After changing something, reload the extension (chrome://extensions → the
// reload arrow on Until, or load it again in Firefox) and reload WebUntis.

const VARIABLES = {
  // ---------- Emoji ----------

  // The emoji Until uses when nobody picked one in the popup yet
  defaultEmoji: "🪑",

  // The emojis you can pick from in the popup (it shows 8 per row).
  // Add, remove or reorder them however you like.
  emojiChoices: [
    "🪑", "🧹", "🧽", "🧼", "🗑️", "✨", "📚", "✏️",
    "🔔", "⏰", "📌", "⚠️", "🚨", "✅", "❗",
  ],

  // The color the emoji glows in while the lesson is about to end.
  // Any CSS color works: "red", "#ff0000", "rgb(255, 0, 0)", ...
  glowColor: "rgb(255, 0, 0)",

  // ---------- Default settings ----------
  // What the popup is set to before a student changes anything.
  // Once a student changes a setting, their own choice is kept.

  // The switches in the popup. true = on, false = off
  switches: {
    notification: true, // system notification before the lesson ends
    alert: true, // alert on the WebUntis page before the lesson ends
    lesson: true, // emoji on the lesson in the timetable
    taskbar: true, // emoji in the WebUntis sidebar
  },

  // The number fields in the popup: the starting value and the lowest
  // and highest number a student can type in
  minutes: {
    // Remind me ... minutes before the lesson ends
    remindMinutes: { default: 5, min: 0, max: 60 },
    // The emoji glows ... minutes before the lesson ends
    showMinutes: { default: 48, min: 0, max: 100 },
  },

  // ---------- Texts ----------
  // The alert and notification texts, one block per language.
  // Until uses the browser's language, and `fallbackLanguage` if there is no block for it.
  //
  // A text can be one string or a list of lines ("" is an empty line).
  // You can put these placeholders anywhere, in any order, as often as you
  // like, or leave them out completely. None of them are required:
  //
  //   {emoji}        the emoji the student picked
  //   {room}         the room, e.g. "404"
  //   {subject}      the subject, e.g. "E"
  //   {teacher}      the teacher's short name, e.g. "DOE"
  //   {class}        the class, e.g. "2A"
  //   {start}        when the lesson starts, e.g. "12:00"
  //   {end}          when the lesson ends, e.g. "12:50"
  //   {minutesLeft}  minutes until the lesson ends, e.g. "5"
  //
  // If WebUntis doesn't know a value (e.g. a lesson without a teacher), it shows "?".

  fallbackLanguage: "en",

  texts: {

    // !!For translating copy the en section!!
    en: {
      // The pop-up on the WebUntis page
      alert: [
        "{emoji} Chairs up!",
        "",
        "You're the last class in room {room} today.",
        "Please leave the room tidy and don't forget to close the windows, clean the board and put the chairs on the tables.",
        "",
        "Lesson: {subject} with {teacher}",
        "Time: {start}-{end}",
        "Ends in: {minutesLeft} min",
      ],

      // The system notification (keep it short, long text gets cut off)
      notificationTitle: "{emoji} Chairs up - room {room} ends in {minutesLeft} min",
      notification: [
        "{subject} with {teacher} ends at {end}.",
        "Close the windows, clean the board, chairs on the tables.",
      ],
    },

    de: {
      alert: [
        "{emoji} Sessel hoch!",
        "",
        "Ihr seid heute die letzte Klasse im Raum {room}.",
        "Bitte verlasst den Raum ordentlich und vergesst nicht, die Fenster zu schließen, die Tafel zu putzen und die Sessel auf die Tische zu stellen.",
        "",
        "Stunde: {subject} bei {teacher}",
        "Zeit: {start}-{end}",
        "Endet in: {minutesLeft} Min.",
      ],

      notificationTitle: "{emoji} Sessel hoch - Raum {room} endet in {minutesLeft} Min.",
      notification: [
        "{subject} bei {teacher} endet um {end}.",
        "Fenster zu, Tafel putzen, Sessel auf die Tische.",
      ],
    },
  },
};