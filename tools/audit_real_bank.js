const fs = require("fs");
const vm = require("vm");

const app = fs.readFileSync("app.js", "utf8");
const elements = new Map();
const local = new Map();

function fakeElement(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      textContent: "",
      innerHTML: "",
      disabled: false,
      dataset: {},
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      closest() { return null; },
      addEventListener() {},
      set onclick(fn) { this._onclick = fn; },
      get onclick() { return this._onclick; }
    });
  }
  return elements.get(id);
}

const context = {
  console,
  Math,
  Date,
  Intl,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  Map,
  RegExp,
  JSON,
  parseFloat,
  parseInt,
  encodeURIComponent,
  process,
  setTimeout(fn) { if (typeof fn === "function") fn(); return 1; },
  window: { KHUSHI_CAT_CONFIG: {}, MathJax: null },
  document: {
    title: "audit",
    getElementById: fakeElement,
    querySelectorAll() { return []; },
    createElement() { return { innerHTML: "", content: { textContent: "" } }; }
  },
  localStorage: {
    getItem(k) { return local.has(k) ? local.get(k) : null; },
    setItem(k, v) { local.set(k, String(v)); },
    removeItem(k) { local.delete(k); }
  },
  location: { reload() {}, href: "" },
  alert() {},
  confirm() { return true; }
};

const audit = `
(function(){
  function addDays(key, days) {
    const p = key.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days, 12)).toISOString().slice(0, 10);
  }
  function bad(value) {
    const text = String(value == null ? "" : value);
    return text.includes("undefined") || /NaN/.test(text) || /actual CAT|completed schedule|final grid/i.test(text);
  }
  function stripHtml(value) {
    return String(value || "").replace(new RegExp("<script[^]*?</script>", "gi"), " ").replace(new RegExp("<style[^]*?</style>", "gi"), " ").replace(/<[^>]+>/g, " ");
  }
  function words(value) {
    return (stripHtml(value).match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
  }

  const failures = [];
  const slots = new Set();
  const ids = new Set();
  const structural = { VARC: new Set(), DILR: new Set(), Quant: new Set() };
  let total = 0;
  let minVarcWords = Infinity;
  let maxVarcWords = 0;

  for (let d = 0; d <= daysBetween(START_DATE, CAT_DATE); d++) {
    const dateKey = addDays(START_DATE, d);
    for (const block of DAILY_BLOCKS) {
      const deck = buildBlockDeck(dateKey, block.id);
      for (const [i, q] of deck.questions.entries()) {
        total++;
        const label = dateKey + " " + block.id + " q" + (i + 1) + " " + q.id;
        if (!q.bankSlot) failures.push(label + " missing bank slot");
        if (slots.has(q.bankSlot)) failures.push(label + " duplicate bank slot " + q.bankSlot);
        slots.add(q.bankSlot);
        if (ids.has(q.id)) failures.push(label + " duplicate id " + q.id);
        ids.add(q.id);
        if (!Array.isArray(q.options) || q.options.length !== 4) failures.push(label + " bad option count");
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) failures.push(label + " bad answer");
        if (new Set(q.options.map(String)).size !== q.options.length) failures.push(label + " duplicate options");
        if ([q.question, q.solution, q.passageHtml, q.visualHtml].concat(q.options).some(bad)) failures.push(label + " bad generated text");
        if (q.section === "VARC") {
          const wc = words(q.passageHtml);
          minVarcWords = Math.min(minVarcWords, wc);
          maxVarcWords = Math.max(maxVarcWords, wc);
          structural.VARC.add(q.topic);
        } else if (q.section === "DILR") {
          structural.DILR.add(q.topic);
        } else {
          structural.Quant.add(q.topic);
        }
      }
    }
  }

  const targets = realBankTargets();
  console.log(JSON.stringify({
    bankVersion: QUESTION_BANK_VERSION,
    targets,
    totalQuestionEntries: total,
    uniqueBankSlots: slots.size,
    uniqueQuestionIds: ids.size,
    structuralFamilies: {
      varcThemes: structural.VARC.size,
      dilrSetFamilies: structural.DILR.size,
      quantTopics: structural.Quant.size
    },
    varcPassageWordRange: [minVarcWords, maxVarcWords],
    failureCount: failures.length,
    failures: failures.slice(0, 25)
  }, null, 2));

  if (failures.length) throw new Error("Real-bank audit failed");
})();`;

vm.runInNewContext(app + audit, context);
