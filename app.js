const START_DATE = "2026-06-30";
const CAT_DATE = "2026-11-29";
const STORE = {
  user: "khushi_daily_cat_user",
  sessions: "khushi_daily_cat_sessions",
  active: "khushi_daily_cat_active_session"
};

const $ = (id) => document.getElementById(id);
const letters = "ABCD";
const IST_TIME_ZONE = "Asia/Kolkata";
const DAILY_BLOCKS = [
  {
    id: "morning-varc",
    title: "Morning VARC",
    target: "4 passages in 1 hour",
    description: "4 RC passages • 16 questions",
    kind: "varc",
    count: 4
  },
  {
    id: "morning-dilr",
    title: "Morning DILR",
    target: "3 sets in 1 hour",
    description: "3 DILR sets • 12 questions",
    kind: "dilr",
    count: 3
  },
  {
    id: "evening-dilr",
    title: "Evening DILR",
    target: "2 sets in the evening",
    description: "2 DILR sets • 8 questions",
    kind: "dilr",
    count: 2
  },
  {
    id: "evening-quant",
    title: "Evening Quant",
    target: "30 Quant questions",
    description: "30 Quant questions • mixed topics",
    kind: "quant",
    count: 30
  }
];

let user = null;
let deck = null;
let activeIndex = 0;
let responses = {};
let paused = false;
let firebaseReady = false;

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 >>> 0;
    return s / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffle(rand, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function optionize(rand, answer, distractors) {
  const set = new Set([String(answer)]);
  for (const d of distractors) {
    if (String(d) !== String(answer)) set.add(String(d));
    if (set.size === 4) break;
  }
  let guard = 1;
  while (set.size < 4) set.add(String(Number(answer) + guard++));
  const options = shuffle(rand, [...set].slice(0, 4));
  return { options, answer: options.indexOf(String(answer)) };
}

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.floor((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / ms);
}

function dateKeyInIst(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function todayKey() {
  return dateKeyInIst();
}

function displayDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeMath(value) {
  let text = String(value ?? "")
    .replace(/\\\\(?=frac\b)/g, "\\")
    .replace(/\\\\\)/g, "\\)");
  let cursor = 0;
  while ((cursor = text.indexOf("\\frac", cursor)) !== -1) {
    const lastOpen = text.lastIndexOf("\\(", cursor);
    const lastClose = text.lastIndexOf("\\)", cursor);
    if (lastOpen > lastClose) {
      cursor += 5;
      continue;
    }
    let end = cursor + 5;
    for (let group = 0; group < 2; group++) {
      while (/\s/.test(text[end] || "")) end++;
      if (text[end] !== "{") {
        end = -1;
        break;
      }
      let depth = 0;
      do {
        if (text[end] === "{") depth++;
        else if (text[end] === "}") depth--;
        end++;
      } while (end < text.length && depth > 0);
      if (depth !== 0) {
        end = -1;
        break;
      }
    }
    if (end < 0) {
      cursor += 5;
      continue;
    }
    let consume = end;
    while (/\s/.test(text[consume] || "")) consume++;
    if (text.slice(consume, consume + 2) === "\\)") consume += 2;
    else if (text[consume] === ")") consume++;
    text = text.slice(0, cursor) + "\\(" + text.slice(cursor, end) + "\\)" + text.slice(consume);
    cursor = end + 4;
  }
  return text;
}

function typesetMath(nodes) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise(nodes).catch(() => {});
  } else {
    setTimeout(() => {
      if (window.MathJax?.typesetPromise) window.MathJax.typesetPromise(nodes).catch(() => {});
    }, 250);
  }
}

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  $("pauseBtn").classList.toggle("hidden", id !== "testScreen");
}

function makeQuestion({ id, section, setTitle, topic, difficulty, passageHtml = "", visualHtml = "", question, options, answer, solution }) {
  return { id, section, setTitle, topic, difficulty, passageHtml, visualHtml, question, options, answer, solution };
}

function makeQuant(seed, index) {
  const rand = rng(seed + index * 982451653);
  const type = index % 10;
  const id = `Q-${seed}-${index}`;

  if (type === 0) {
    const cp = pick(rand, [800, 1000, 1200, 1500, 1800, 2400]);
    const markup = pick(rand, [25, 30, 40, 50, 60]);
    const d1 = pick(rand, [10, 12.5, 15, 20]);
    const d2 = pick(rand, [5, 10, 12.5]);
    const sp = cp * (1 + markup / 100) * (1 - d1 / 100) * (1 - d2 / 100);
    const ans = `${Number(((sp - cp) * 100 / cp).toFixed(2))}%`;
    const opts = optionize(rand, ans, [`${markup - d1 - d2}%`, `${Number((parseFloat(ans) + 5).toFixed(2))}%`, `${Number((parseFloat(ans) - 5).toFixed(2))}%`]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Profit, Loss and Discount", difficulty: "Moderate-Difficult",
      question: `An article costing Rs. ${cp} is marked ${markup}% above cost price. Two successive discounts of ${d1}% and ${d2}% are given. What is the profit percentage?`,
      ...opts,
      solution: `Let cost be \\(100\\). Marked price \\(= ${100 + markup}\\). Selling price \\(= ${100 + markup}\\times ${(100 - d1) / 100}\\times ${(100 - d2) / 100} = ${Number((sp * 100 / cp).toFixed(2))}\\). Profit percentage = ${ans}.`
    });
  }

  if (type === 1) {
    const s = pick(rand, [4, 5, 6, 7, 8]);
    const ans = s ** 3 - 3 * s;
    const opts = optionize(rand, ans, [ans + 6, ans - 6, s ** 3 - 2 * s, s ** 3 + 3 * s]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Algebra", difficulty: "Difficult",
      question: `If \\(x+\\frac{1}{x}=${s}\\), where \\(x>0\\), find \\(x^3+\\frac{1}{x^3}\\).`,
      ...opts,
      solution: `Use \\(a^3+b^3=(a+b)^3-3ab(a+b)\\). Here \\(a=x\\), \\(b=\\frac{1}{x}\\), and \\(ab=1\\). So \\(x^3+\\frac{1}{x^3}=${s}^3-3(${s})=${ans}\\).`
    });
  }

  if (type === 2) {
    const a = pick(rand, [18, 20, 24, 30, 36]);
    const b = pick(rand, [24, 30, 36, 40, 48]);
    const c = pick(rand, [36, 45, 60]);
    const firstDays = pick(rand, [3, 4, 5, 6]);
    const secondDays = pick(rand, [4, 5, 6, 8]);
    const done = firstDays * (1 / a + 1 / b + 1 / c) + secondDays * (1 / b + 1 / c);
    const rem = Math.max(0, 1 - done);
    const extra = rem * c;
    const ans = Number((firstDays + secondDays + extra).toFixed(2));
    const opts = optionize(rand, ans, [Math.round(ans), Number((ans + 2).toFixed(2)), Number((ans - 2).toFixed(2))]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Time and Work", difficulty: "Moderate-Difficult",
      question: `A, B and C can finish a work in ${a}, ${b} and ${c} days respectively. They work together for ${firstDays} days. Then A leaves, and B and C work for ${secondDays} more days. C completes the remaining work alone. How many total days are required?`,
      ...opts,
      solution: `Work done \\(= ${firstDays}(\\frac{1}{${a}}+\\frac{1}{${b}}+\\frac{1}{${c}})+${secondDays}(\\frac{1}{${b}}+\\frac{1}{${c}})=${done.toFixed(4)}\\). Remaining \\(=${rem.toFixed(4)}\\). C takes \\(\\frac{\\text{remaining}}{1/${c}}=${extra.toFixed(2)}\\) days. Total \\(=${ans}\\).`
    });
  }

  if (type === 3) {
    const d = pick(rand, [120, 180, 240, 300]);
    const s1 = pick(rand, [30, 36, 40, 45, 60]);
    const s2 = pick(rand, [45, 60, 72, 90]);
    const avg = Number((2 * s1 * s2 / (s1 + s2)).toFixed(2));
    const ans = `${avg} km/h`;
    const opts = optionize(rand, ans, [`${(s1 + s2) / 2} km/h`, `${avg + 5} km/h`, `${Math.max(1, avg - 5)} km/h`]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Speed Time Distance", difficulty: "Moderate-Difficult",
      question: `A person travels ${d} km at ${s1} km/h and returns the same distance at ${s2} km/h. What is the average speed for the whole journey?`,
      ...opts,
      solution: `For equal distances, average speed is harmonic mean: \\(\\frac{2ab}{a+b}=\\frac{2\\times ${s1}\\times ${s2}}{${s1}+${s2}}=${avg}\\) km/h.`
    });
  }

  if (type === 4) {
    const p = pick(rand, [20, 25, 30, 40]);
    const target = pick(rand, [50, 60, 70]);
    const vol = pick(rand, [20, 30, 40, 50, 60]);
    const x = Number((vol * (target - p) / (100 - target)).toFixed(2));
    const ans = `${x} litres`;
    const opts = optionize(rand, ans, [`${x + 5} litres`, `${Math.max(1, x - 5)} litres`, `${vol * (target - p) / 100} litres`]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Mixtures", difficulty: "Moderate-Difficult",
      question: `${vol} litres of a solution contains ${p}% alcohol. How many litres of pure alcohol must be added to make it ${target}% alcohol?`,
      ...opts,
      solution: `Initial alcohol \\(=${vol * p / 100}\\). Let \\(x\\) be pure alcohol added. \\(\\frac{${vol * p / 100}+x}{${vol}+x}=\\frac{${target}}{100}\\). Solving gives \\(x=${x}\\) litres.`
    });
  }

  if (type === 5) {
    const n = pick(rand, [4, 5, 6, 7]);
    const d = pick(rand, [7, 9, 11, 13]);
    const lo = 10 ** (n - 1), hi = 10 ** n - 1;
    const first = Math.ceil(lo / d) * d, last = Math.floor(hi / d) * d;
    const ans = Math.floor((last - first) / d) + 1;
    const opts = optionize(rand, ans, [ans + 1, ans - 1, ans + d]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Number System", difficulty: "Moderate",
      question: `How many ${n}-digit positive integers are divisible by ${d}?`,
      ...opts,
      solution: `Smallest ${n}-digit multiple of ${d} is ${first}; largest is ${last}. Count \\(=\\frac{${last}-${first}}{${d}}+1=${ans}\\).`
    });
  }

  if (type === 6) {
    const base = pick(rand, [10, 12, 14, 16, 18, 20]);
    const side = pick(rand, [13, 15, 17, 20, 25]);
    const h = Math.sqrt(side * side - (base / 2) ** 2);
    const area = Number((base * h / 2).toFixed(2));
    const perimeter = 2 * side + base;
    const inradius = Number((area / (perimeter / 2)).toFixed(2));
    const ans = `${inradius}`;
    const opts = optionize(rand, ans, [`${Number((inradius + 1).toFixed(2))}`, `${Number((inradius - 1).toFixed(2))}`, `${Number((area / perimeter).toFixed(2))}`]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Geometry", difficulty: "Difficult",
      question: `An isosceles triangle has equal sides ${side} cm each and base ${base} cm. What is its inradius?`,
      ...opts,
      solution: `Height \\(=\\sqrt{${side}^2-(${base}/2)^2}=${h.toFixed(2)}\\). Area \\(=${area}\\). Semiperimeter \\(=${perimeter / 2}\\). Inradius \\(=\\frac{\\text{area}}{\\text{semiperimeter}}=${inradius}\\).`
    });
  }

  if (type === 7) {
    const n = pick(rand, [6, 7, 8, 9]);
    const r = pick(rand, [2, 3, 4]);
    const ans = combination(n, r);
    const opts = optionize(rand, ans, [permutation(n, r), ans + n, ans - r]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Combinatorics", difficulty: "Moderate-Difficult",
      question: `From ${n} people, how many committees of ${r} people can be formed if order does not matter?`,
      ...opts,
      solution: `Committees are selections, so use combinations: \\({}^{${n}}C_{${r}}=${ans}\\).`
    });
  }

  if (type === 8) {
    const sum = pick(rand, [18, 20, 22, 24, 26]);
    const diff = pick(rand, [2, 4, 6]);
    const r1 = (sum - diff) / 2, r2 = (sum + diff) / 2;
    const ans = r1 * r2;
    const opts = optionize(rand, ans, [ans + sum, ans - diff, sum * diff]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Quadratics", difficulty: "Difficult",
      question: `The roots of \\(x^2-${sum}x+k=0\\) are positive and differ by ${diff}. What is \\(k\\)?`,
      ...opts,
      solution: `Roots have sum \\(${sum}\\) and difference \\(${diff}\\). They are \\(\\frac{${sum}-${diff}}{2}=${r1}\\) and \\(\\frac{${sum}+${diff}}{2}=${r2}\\). Product \\(k=${ans}\\).`
    });
  }

  const threshold = pick(rand, [8, 9, 10, 11]);
  const fav = Array.from({ length: 6 }, (_, a) => a + 1).flatMap((a) => Array.from({ length: 6 }, (_, b) => [a, b + 1])).filter(([a, b]) => a + b >= threshold).length;
  const g = gcd(fav, 36);
  const ans = `${fav / g}/${36 / g}`;
  const opts = optionize(rand, ans, [`${fav}/36`, `${Math.max(1, fav - 2)}/36`, `${Math.min(35, fav + 2)}/36`]);
  return makeQuestion({
    id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Probability", difficulty: "Moderate-Difficult",
    question: `Two fair dice are rolled. What is the probability that the sum is at least ${threshold}?`,
    ...opts,
    solution: `Total outcomes \\(=36\\). Favourable outcomes with sum at least ${threshold} \\(=${fav}\\). Probability \\(=\\frac{${fav}}{36}=${ans}\\).`
  });
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a);
}

function combination(n, r) {
  return permutation(n, r) / factorial(r);
}

function permutation(n, r) {
  let out = 1;
  for (let i = 0; i < r; i++) out *= n - i;
  return out;
}

function factorial(n) {
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

const varcThemes = [
  ["algorithmic taste", "platforms increasingly predict what people will enjoy before they ask for it", "choice can become narrower precisely when it appears abundant"],
  ["urban memory", "redevelopment often treats older neighbourhoods as inefficient clutter", "a city also needs traces that help residents remain oriented"],
  ["scientific models", "a good model deliberately ignores many details", "simplification is useful only when it serves a clearly framed question"],
  ["workplace speed", "instant replies have become a visible signal of competence", "the fastest decision is not always the decision that moves work forward"],
  ["museum silence", "curation decides what deserves attention and what fades into the background", "neutral display can quietly produce a strong argument"],
  ["education metrics", "scores convert learning into something sortable", "measurement can improve focus while also shrinking imagination"],
  ["ecological restoration", "restoring a landscape is not the same as rewinding it", "repair has to work with altered conditions rather than deny them"],
  ["language change", "new words are often accused of corrupting older forms", "language survives by negotiating use, not by freezing itself"]
];

function makeVarcSet(seed) {
  const rand = rng(seed ^ 0xabcddcba);
  const [theme, claim, tension] = pick(rand, varcThemes);
  const passage = `
    <p>Debates about ${theme} often begin with a complaint that something valuable has been lost. The complaint is not always wrong, but it is usually incomplete. When ${claim}, critics tend to focus on the visible replacement and miss the quieter bargain being made underneath.</p>
    <p>The more interesting question is not whether the old arrangement was better in every respect. It rarely was. The question is what kind of judgment the new arrangement trains people to exercise. A tool that saves time may also reduce the occasions on which people practise patience; a system that widens access may also flatten the differences that made access meaningful.</p>
    <p>This is why nostalgia and enthusiasm are both unreliable guides. Nostalgia mistakes familiarity for wisdom, while enthusiasm mistakes novelty for progress. The harder task is to ask what must be preserved for the new system to remain humane. In the case of ${theme}, ${tension}.</p>
  `;
  const stem = `The passage is primarily concerned with`;
  const options = [
    `arguing that ${theme} should be rejected because older systems were always superior.`,
    `showing that debates on ${theme} require judging both gains and losses created by change.`,
    `claiming that technological and social changes are impossible to evaluate rationally.`,
    `proving that nostalgia is more reliable than enthusiasm in public debates.`
  ];
  const q1 = makeQuestion({
    id: `V-${seed}-1`, section: "VARC", setTitle: "Reading Comprehension", topic: theme, difficulty: "Moderate-Difficult",
    passageHtml: passage, question: stem, options, answer: 1,
    solution: `The passage rejects both nostalgia and enthusiasm and asks for a balanced evaluation of what change trains people to value. Option B captures this.`
  });
  const q2 = makeQuestion({
    id: `V-${seed}-2`, section: "VARC", setTitle: "Reading Comprehension", topic: theme, difficulty: "Moderate-Difficult",
    passageHtml: passage, question: `Which statement would the author most likely agree with?`,
    options: [
      `The old arrangement was flawless and should be restored.`,
      `A new system should be assessed by the habits of judgment it encourages.`,
      `Any increase in access necessarily damages quality.`,
      `Familiar systems are always more humane than new systems.`
    ],
    answer: 1,
    solution: `Paragraph 2 says the key question is what kind of judgment the new arrangement trains people to exercise.`
  });
  const q3 = makeQuestion({
    id: `V-${seed}-3`, section: "VARC", setTitle: "Reading Comprehension", topic: theme, difficulty: "Difficult",
    passageHtml: passage, question: `The phrase "quieter bargain" most nearly refers to`,
    options: [
      `an explicit agreement between critics and supporters.`,
      `a hidden trade-off produced by adopting a new arrangement.`,
      `a financial transaction that is difficult to measure.`,
      `a refusal to compare old and new systems.`
    ],
    answer: 1,
    solution: `The phrase points to less visible trade-offs: time saved may reduce patience, access widened may flatten meaningful differences.`
  });
  const q4 = makeQuestion({
    id: `V-${seed}-4`, section: "VARC", setTitle: "Reading Comprehension", topic: theme, difficulty: "Difficult",
    passageHtml: passage, question: `Which option best weakens the author's warning?`,
    options: [
      `Evidence that users of the new system practise more careful judgment than users of the older system.`,
      `Evidence that many people dislike change initially.`,
      `Evidence that older systems were familiar to more people.`,
      `Evidence that critics of change often exaggerate their claims.`
    ],
    answer: 0,
    solution: `The author's warning is about new systems weakening judgment/humaneness. Showing they improve careful judgment directly weakens that warning.`
  });
  return [q1, q2, q3, q4];
}

function makeDilrSet(seed) {
  const rand = rng(seed ^ 0x53a9b71);
  const names = shuffle(rand, ["Asha", "Bimal", "Charu", "Dev", "Esha", "Farah"]).slice(0, 5);
  const subjects = shuffle(rand, ["Algebra", "Geometry", "Arithmetic", "Logic", "Reading"]).slice(0, 5);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const order = shuffle(rand, [...names]);
  const subjectOrder = shuffle(rand, [...subjects]);
  const rows = days.map((day, i) => ({ day, name: order[i], subject: subjectOrder[i], score: 62 + Math.floor(rand() * 27) }));
  const maxScore = rows.reduce((a, b) => a.score > b.score ? a : b);
  const logicPerson = rows.find((r) => r.subject === "Logic");
  const thu = rows.find((r) => r.day === "Thu");
  const avg = Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);
  const table = `<table><thead><tr><th>Day</th><th>Student</th><th>Practice Area</th><th>Score</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.day}</td><td>${r.name}</td><td>${r.subject}</td><td>${r.score}</td></tr>`).join("")}</tbody></table>`;
  const passage = `
    <p>Five students each took one focused practice session on a different weekday. Each student had a different practice area and a different score. The completed schedule is shown below. Use the table to answer the questions. In an actual CAT set, this is the final grid you would derive from the clues.</p>
    ${table}
  `;
  const visual = makeBarSvg(rows);
  const q = [];
  q.push(makeQuestion({
    id: `D-${seed}-1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Schedule + Table", difficulty: "Moderate-Difficult",
    passageHtml: passage, visualHtml: visual, question: "Who obtained the highest score?", options: rows.map((r) => r.name), answer: rows.findIndex((r) => r.name === maxScore.name),
    solution: `Compare the scores in the table. The highest score is ${maxScore.score}, obtained by ${maxScore.name}.`
  }));
  q.push(makeQuestion({
    id: `D-${seed}-2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Schedule + Table", difficulty: "Moderate-Difficult",
    passageHtml: passage, visualHtml: visual, question: "On which day was Logic practised?", options: days, answer: days.indexOf(logicPerson.day),
    solution: `Locate the row where Practice Area is Logic. It appears on ${logicPerson.day}.`
  }));
  q.push(makeQuestion({
    id: `D-${seed}-3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Schedule + Table", difficulty: "Difficult",
    passageHtml: passage, visualHtml: visual, question: "What is the difference between the highest and lowest score?", options: optionize(rand, maxScore.score - Math.min(...rows.map((r) => r.score)), [8, 12, 15, 20]).options, answer: 0,
    solution: ""
  }));
  const last = q[q.length - 1];
  const diff = maxScore.score - Math.min(...rows.map((r) => r.score));
  const diffOpts = optionize(rand, diff, [diff + 3, Math.max(1, diff - 3), diff + 5]);
  last.options = diffOpts.options; last.answer = diffOpts.answer;
  last.solution = `Highest score = ${maxScore.score}; lowest score = ${Math.min(...rows.map((r) => r.score))}. Difference = ${diff}.`;
  q.push(makeQuestion({
    id: `D-${seed}-4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Schedule + Table", difficulty: "Moderate-Difficult",
    passageHtml: passage, visualHtml: visual, question: "Which practice area was taken on Thursday?", options: subjects, answer: subjects.indexOf(thu.subject),
    solution: `Read the Thursday row. The practice area on Thursday is ${thu.subject}.`
  }));
  return q;
}

function makeBarSvg(rows) {
  const max = Math.max(...rows.map((r) => r.score));
  return `<svg viewBox="0 0 520 260" role="img" aria-label="Score bar chart">
    <rect x="0" y="0" width="520" height="260" rx="18" fill="rgba(255,255,255,.05)"></rect>
    ${rows.map((r, i) => {
      const h = Math.round(150 * r.score / max);
      const x = 42 + i * 92, y = 205 - h;
      return `<rect x="${x}" y="${y}" width="48" height="${h}" rx="8" fill="#69e6d5"></rect><text x="${x + 24}" y="${y - 8}" text-anchor="middle" fill="#fbf6e8" font-size="14">${r.score}</text><text x="${x + 24}" y="230" text-anchor="middle" fill="#b8c1d6" font-size="13">${r.day}</text>`;
    }).join("")}
  </svg>`;
}

function getBlock(blockId) {
  return DAILY_BLOCKS.find((block) => block.id === blockId) || DAILY_BLOCKS[0];
}

function sessionKey(dateKey, blockId) {
  return `${dateKey}__${blockId}`;
}

function questionsForBlock(block, seed, offset) {
  if (block.kind === "varc") {
    return Array.from({ length: block.count }, (_, i) => makeVarcSet(seed + i * 9973)).flat();
  }
  if (block.kind === "dilr") {
    return Array.from({ length: block.count }, (_, i) => makeDilrSet(seed + i * 7919)).flat();
  }
  return Array.from({ length: block.count }, (_, i) => makeQuant(seed + 31, offset * 1000 + i));
}

function buildBlockDeck(dateKey = todayKey(), blockId = DAILY_BLOCKS[0].id) {
  const offset = Math.max(0, daysBetween(START_DATE, dateKey));
  const block = getBlock(blockId);
  const seed = hashString(`khushi-${dateKey}-${block.id}-${offset}`);
  return {
    dateKey,
    blockId: block.id,
    blockTitle: block.title,
    target: block.target,
    sessionKey: sessionKey(dateKey, block.id),
    createdAt: new Date().toISOString(),
    submittedAt: null,
    questions: questionsForBlock(block, seed, offset)
  };
}

function buildDailyDeck(dateKey = todayKey()) {
  return {
    dateKey,
    createdAt: new Date().toISOString(),
    submittedAt: null,
    questions: DAILY_BLOCKS.flatMap((block) => buildBlockDeck(dateKey, block.id).questions)
  };
}

function getSession(dateKey = todayKey(), blockId = DAILY_BLOCKS[0].id) {
  const sessions = readJson(STORE.sessions, {});
  const key = sessionKey(dateKey, blockId);
  if (!sessions[key]) {
    const fresh = buildBlockDeck(dateKey, blockId);
    sessions[key] = { deck: fresh, responses: {}, report: null };
    writeJson(STORE.sessions, sessions);
  }
  return sessions[key];
}

function saveCurrentSession() {
  const sessions = readJson(STORE.sessions, {});
  const key = deck.sessionKey || sessionKey(deck.dateKey, deck.blockId || DAILY_BLOCKS[0].id);
  sessions[key] = sessions[key] || {};
  sessions[key].deck = deck;
  sessions[key].responses = responses;
  sessions[key].report = sessions[key].report || null;
  writeJson(STORE.sessions, sessions);
  writeJson(STORE.active, { dateKey: deck.dateKey, blockId: deck.blockId, sessionKey: key, activeIndex, paused });
}

function startSession(blockId = DAILY_BLOCKS[0].id) {
  const dateKey = todayKey();
  const session = getSession(dateKey, blockId);
  if (session.report) {
    alert("This block is already complete for today. Fresh questions unlock tomorrow.");
    renderHome();
    return;
  }
  deck = session.deck;
  responses = session.responses || {};
  const active = readJson(STORE.active, {});
  activeIndex = active.sessionKey === deck.sessionKey ? active.activeIndex || 0 : 0;
  paused = false;
  show("testScreen");
  renderQuestion();
}

function renderQuestion() {
  const q = deck.questions[activeIndex];
  $("sectionLabel").textContent = `${q.section} • ${q.topic}`;
  $("questionTitle").textContent = `${deck.blockTitle || q.setTitle}`;
  $("sourceLabel").textContent = `${deck.target || q.difficulty} • ${q.difficulty} • Daily generated verified practice`;
  $("progressText").textContent = `Question ${activeIndex + 1} of ${deck.questions.length}`;
  $("passagePanel").innerHTML = q.passageHtml || "<p>No passage is required for this Quant question.</p>";
  $("questionText").textContent = normalizeMath(q.question);
  $("visualPanel").innerHTML = q.visualHtml || "";
  $("visualPanel").classList.toggle("hidden", !q.visualHtml);
  $("optionsPanel").innerHTML = q.options.map((o, i) => `
    <button class="option ${responses[q.id] === i ? "selected" : ""}" data-option="${i}">
      <span class="badge">${letters[i]}</span><span>${normalizeMath(o)}</span>
    </button>`).join("");
  $("prevBtn").disabled = activeIndex === 0;
  $("nextBtn").textContent = activeIndex === deck.questions.length - 1 ? "Last question" : "Next";
  saveCurrentSession();
  typesetMath([$("questionText"), $("optionsPanel"), $("passagePanel"), $("visualPanel")]);
}

function selectOption(index) {
  responses[deck.questions[activeIndex].id] = index;
  $("saveState").textContent = "Saved just now.";
  renderQuestion();
}

function finishSession() {
  if (!confirm(`Finish ${deck.blockTitle || "today's practice"} and unlock solutions? This block will reset tomorrow.`)) return;
  const report = makeReport();
  const sessions = readJson(STORE.sessions, {});
  const key = deck.sessionKey || sessionKey(deck.dateKey, deck.blockId || DAILY_BLOCKS[0].id);
  sessions[key] = { deck, responses, report };
  sessions[key].deck.submittedAt = new Date().toISOString();
  writeJson(STORE.sessions, sessions);
  renderReport(report);
  show("reportScreen");
}

function makeReport() {
  const bySection = {};
  const wrongTopics = {};
  let correct = 0, attempted = 0;
  const items = [];
  for (const q of deck.questions) {
    const picked = responses[q.id];
    const ok = picked === q.answer;
    if (picked !== undefined) attempted++;
    if (ok) correct++;
    bySection[q.section] = bySection[q.section] || { total: 0, correct: 0, attempted: 0 };
    bySection[q.section].total++;
    if (picked !== undefined) bySection[q.section].attempted++;
    if (ok) bySection[q.section].correct++;
    if (!ok) wrongTopics[q.topic] = (wrongTopics[q.topic] || 0) + 1;
    items.push(questionAnalysis(q, picked, ok));
  }
  const accuracy = attempted ? Math.round(correct * 100 / attempted) : 0;
  const weakest = Object.entries(wrongTopics).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    dateKey: deck.dateKey,
    blockId: deck.blockId,
    blockTitle: deck.blockTitle,
    target: deck.target,
    total: deck.questions.length,
    attempted,
    correct,
    accuracy,
    bySection,
    weakest,
    items
  };
}

function questionAnalysis(q, picked, ok) {
  const unattempted = picked === undefined;
  const errorType = ok ? "Correct" : unattempted ? "Unattempted" : classifyError(q);
  return {
    id: q.id,
    section: q.section,
    topic: q.topic,
    difficulty: q.difficulty,
    question: q.question,
    userAnswer: unattempted ? "Unattempted" : `${letters[picked]}. ${q.options[picked]}`,
    correctAnswer: `${letters[q.answer]}. ${q.options[q.answer]}`,
    correct: ok,
    errorType,
    solution: q.solution,
    formula: formulaFor(q),
    betterWay: betterWayFor(q, errorType),
    nextStep: nextStepFor(q, errorType)
  };
}

function classifyError(q) {
  if (q.section === "VARC") return "Interpretation / option trap";
  if (q.section === "DILR") return "Table reading / condition mapping";
  if (["Profit, Loss and Discount", "Mixtures", "Time and Work", "Speed Time Distance"].includes(q.topic)) return "Formula setup";
  if (["Algebra", "Quadratics", "Geometry", "Number System"].includes(q.topic)) return "Concept or transformation";
  return "Execution / option elimination";
}

function formulaFor(q) {
  const map = {
    "Profit, Loss and Discount": "Successive change multiplier: \\(\\text{final}=\\text{initial}\\times(1+a/100)\\times(1-b/100)\\).",
    "Algebra": "If \\(x+\\frac{1}{x}=a\\), then \\(x^3+\\frac{1}{x^3}=a^3-3a\\).",
    "Time and Work": "Work done \\(=\\sum \\frac{\\text{time worked}}{\\text{days needed alone}}\\). Add fractional work, then convert the remaining fraction into days.",
    "Speed Time Distance": "For equal distances, average speed \\(=\\frac{2ab}{a+b}\\).",
    "Mixtures": "Set concentration equation: \\(\\frac{\\text{old solute}+\\text{added solute}}{\\text{new volume}}=\\text{target concentration}\\).",
    "Number System": "Count multiples from first valid multiple to last valid multiple: \\(\\frac{\\text{last}-\\text{first}}{d}+1\\).",
    "Geometry": "Inradius formula: \\(r=\\frac{\\text{Area}}{s}\\), where \\(s\\) is semiperimeter.",
    "Combinatorics": "Selection uses \\({}^nC_r\\); arrangement uses \\({}^nP_r\\).",
    "Quadratics": "For roots with sum \\(S\\) and difference \\(D\\), roots are \\(\\frac{S-D}{2}\\) and \\(\\frac{S+D}{2}\\).",
    "Probability": "Probability \\(=\\frac{\\text{favourable outcomes}}{\\text{total outcomes}}\\).",
    "Schedule + Table": "Read the final grid carefully; compare one row/column at a time."
  };
  if (q.section === "VARC") return "RC method: identify conclusion, tone, and scope; reject options that are extreme, outside scope, or reverse the author's claim.";
  return map[q.topic] || "Use the conditions exactly as written; convert the wording into a small table/equation before choosing an option.";
}

function betterWayFor(q, errorType) {
  if (q.section === "VARC") {
    return "Before looking at options, write a 6-8 word prediction of the answer. Then eliminate options that change the scope or overstate the claim.";
  }
  if (q.section === "DILR") {
    return "Do not solve from memory. Mark the relevant row/column first, then answer only the asked comparison. Most mistakes here come from reading the right table but the wrong field.";
  }
  if (q.topic === "Time and Work") return "Use fractional work instead of LCM-heavy calculations. Stop after computing completed work; only then convert the remaining fraction into days.";
  if (q.topic === "Mixtures") return "Use one variable x and build the final concentration equation directly. Avoid alligation unless two ready-made mixtures are being combined.";
  if (q.topic === "Speed Time Distance") return "When distances are equal, go straight to harmonic mean. Do not average the two speeds.";
  if (q.topic === "Algebra") return "Recognize the identity first; expanding powers directly wastes time and increases error risk.";
  if (q.topic === "Geometry") return "Draw the altitude/semiperimeter relationship first. Inradius questions often collapse to area divided by semiperimeter.";
  return errorType === "Correct" ? "Good. Still read the solution once and note the fastest route." : "Redo this question once without options. If the setup is correct, the answer should fall out cleanly.";
}

function nextStepFor(q, errorType) {
  if (errorType === "Correct") return "Keep this as a green question; revisit only during weekly revision.";
  if (errorType === "Unattempted") return "Attempt it untimed tonight. If it still feels blocked after 4 minutes, write down the first missing concept.";
  if (q.section === "VARC") return "Practise 3 RC questions focused only on option elimination and write why each wrong option is wrong.";
  if (q.section === "DILR") return "Redo the set by rebuilding the grid/table from scratch, then compare your grid with the solution.";
  return `Revise ${q.topic}, then solve 3 similar questions before moving to a new topic.`;
}

function renderReport(report) {
  const reportItems = report.items || deck.questions.map((q) => {
    const picked = responses[q.id];
    return questionAnalysis(q, picked, picked === q.answer);
  });
  $("reportTitle").textContent = `${report.blockTitle || "Analysis"} • ${displayDate(report.dateKey)}`;
  $("scoreSummary").innerHTML = `
    <div><b>${report.correct}/${report.total}</b><span>correct</span></div>
    <div><b>${report.attempted}</b><span>attempted</span></div>
    <div><b>${report.accuracy}%</b><span>accuracy</span></div>
    <div><b>${Object.keys(report.bySection).length}</b><span>sections</span></div>`;
  const sec = Object.entries(report.bySection).map(([name, s]) => `<li><b>${name}</b>: ${s.correct}/${s.total} correct, ${s.attempted} attempted.</li>`).join("");
  const weak = report.weakest.length ? report.weakest.map(([t, n]) => `<li>${t}: ${n} miss${n > 1 ? "es" : ""}. Revise concept, then redo similar questions untimed.</li>`).join("") : "<li>No weak area today. Preserve this pace and review solutions anyway.</li>";
  const detailed = reportItems.map((item, i) => `
    <article class="mini-analysis ${item.correct ? "correct" : "wrong"}">
      <div class="review-meta">Q${i + 1} • ${item.section} • ${item.topic} • ${item.errorType}</div>
      <h4>${normalizeMath(item.question)}</h4>
      <p><b>Khushi's answer:</b> <span class="${item.correct ? "pill-good" : "pill-bad"}">${normalizeMath(item.userAnswer)}</span></p>
      <p><b>Correct answer:</b> <span class="pill-good">${normalizeMath(item.correctAnswer)}</span></p>
      <p><b>Formula / idea used:</b> ${normalizeMath(item.formula)}</p>
      <p><b>Better way:</b> ${normalizeMath(item.betterWay)}</p>
      <p><b>Solution:</b> ${normalizeMath(item.solution)}</p>
      <p><b>Next step:</b> ${normalizeMath(item.nextStep)}</p>
    </article>`).join("");
  $("improvementBox").innerHTML = `
    <h3>What went wrong</h3><ul>${sec}</ul>
    <h3>What to do next</h3><ul>${weak}</ul>
    <p>Recommendation: spend 20 minutes reviewing only wrong and unattempted questions, then write one-line error notes: concept gap, calculation slip, misread condition, or option trap.</p>
    <h3>Question-by-question AI-style review</h3>${detailed}`;
  typesetMath([$("improvementBox")]);
}

function renderReview() {
  $("reviewList").innerHTML = deck.questions.map((q, i) => {
    const picked = responses[q.id];
    const ok = picked === q.answer;
    return `<article class="review-item ${ok ? "correct" : "wrong"}">
      <div class="review-meta">${i + 1}. ${q.section} • ${q.topic} • ${q.difficulty}</div>
      <h3>${normalizeMath(q.question)}</h3>
      ${q.passageHtml ? `<div class="solution">${q.passageHtml}</div>` : ""}
      ${q.visualHtml ? `<div class="visual-panel">${q.visualHtml}</div>` : ""}
      <p>Your answer: <span class="${ok ? "pill-good" : "pill-bad"}">${normalizeMath(picked === undefined ? "Unattempted" : letters[picked] + ". " + q.options[picked])}</span></p>
      <p>Correct answer: <span class="pill-good">${normalizeMath(letters[q.answer] + ". " + q.options[q.answer])}</span></p>
      <p><b>Formula / idea:</b> ${normalizeMath(formulaFor(q))}</p>
      <p><b>Better way:</b> ${normalizeMath(betterWayFor(q, ok ? "Correct" : picked === undefined ? "Unattempted" : classifyError(q)))}</p>
      <div class="solution"><b>Detailed solution:</b><br>${normalizeMath(q.solution)}</div>
    </article>`;
  }).join("");
  typesetMath([$("reviewList")]);
}

function renderHistory() {
  const sessions = readJson(STORE.sessions, {});
  const rows = Object.values(sessions).sort((a, b) => {
    const ad = a.deck.submittedAt || a.deck.createdAt || a.deck.dateKey;
    const bd = b.deck.submittedAt || b.deck.createdAt || b.deck.dateKey;
    return bd.localeCompare(ad);
  });
  $("historyList").innerHTML = rows.length ? rows.map((s) => {
    const r = s.report;
    return `<article class="review-item">
      <div class="review-meta">${displayDate(s.deck.dateKey)} • ${s.deck.blockTitle || "Daily set"}</div>
      <h3>${r ? `${r.correct}/${r.total} correct • ${r.accuracy}% accuracy` : "Started, not finished"}</h3>
      <p>${Object.keys(s.responses || {}).length} responses saved.</p>
    </article>`;
  }).join("") : `<div class="review-item">No solved sessions yet.</div>`;
}

function sendEmailReport() {
  const report = makeReport();
  const lines = [
    `Khushi's CAT report: ${report.blockTitle || "Daily set"} for ${displayDate(report.dateKey)}`,
    ``,
    `Correct: ${report.correct}/${report.total}`,
    `Attempted: ${report.attempted}`,
    `Accuracy: ${report.accuracy}%`,
    ``,
    `Weak areas: ${report.weakest.map(([t, n]) => `${t} (${n})`).join(", ") || "None"}`,
    ``,
    `Question-wise review:`,
    ...report.items.map((item, i) => [
      ``,
      `Q${i + 1}. ${item.section} - ${item.topic}`,
      `Question: ${item.question}`,
      `Khushi's answer: ${item.userAnswer}`,
      `Correct answer: ${item.correctAnswer}`,
      `Error type: ${item.errorType}`,
      `Formula/idea: ${item.formula}`,
      `Better way: ${item.betterWay}`,
      `Solution: ${item.solution}`,
      `Next step: ${item.nextStep}`
    ].join(`\n`))
  ];
  const body = encodeURIComponent(lines.join("\n"));
  const cfg = window.KHUSHI_CAT_CONFIG?.emailjs;
  if (cfg?.publicKey && window.emailjs) {
    alert("EmailJS is configured, but this static build needs the EmailJS browser SDK script added. Falling back to mail draft.");
  }
  const subject = encodeURIComponent("Khushi CAT Daily Report");
  location.href = `mailto:${cfg?.toEmail || ""}?subject=${subject}&body=${body}`;
}

function downloadPdfReport() {
  const originalTitle = document.title;
  const dateLabel = deck?.dateKey ? displayDate(deck.dateKey).replace(/ /g, "-") : "today";
  const blockLabel = (deck?.blockTitle || "Daily").replace(/\s+/g, "-");
  document.title = `Khushi-CAT-${blockLabel}-Report-${dateLabel}`;
  const printNow = () => {
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 600);
  };
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([$("improvementBox"), $("scoreSummary")]).finally(printNow);
  } else {
    printNow();
  }
}

function renderHome() {
  const date = todayKey();
  const sessions = readJson(STORE.sessions, {});
  const blockStates = DAILY_BLOCKS.map((block) => {
    const session = sessions[sessionKey(date, block.id)];
    return { block, session, done: Boolean(session?.report), started: Boolean(session && !session.report) };
  });
  const doneToday = blockStates.filter((state) => state.done).length;
  const totalQuestionsPerDay = DAILY_BLOCKS.reduce((sum, block) => {
    if (block.kind === "varc") return sum + block.count * 4;
    if (block.kind === "dilr") return sum + block.count * 4;
    return sum + block.count;
  }, 0);
  const totalDays = Math.max(0, daysBetween(START_DATE, CAT_DATE) + 1);
  $("todayLine").textContent = `${displayDate(date)} is ready: Morning VARC, Morning DILR, Evening DILR, and Evening Quant. Completed blocks lock until tomorrow's reset.`;
  $("daysLeft").textContent = Math.max(0, daysBetween(date, CAT_DATE) + 1);
  $("bankCount").textContent = `${(totalQuestionsPerDay * totalDays).toLocaleString("en-IN")}+`;
  $("doneCount").textContent = `${doneToday}/${DAILY_BLOCKS.length}`;
  $("taskGrid").innerHTML = blockStates.map(({ block, done, started }) => `
    <button class="task-card ${done ? "done" : ""}" data-block="${block.id}" ${done ? "disabled" : ""}>
      <span class="task-status">${done ? "Done for today" : started ? "Resume" : "Available now"}</span>
      <b>${block.title}</b>
      <span>${block.target}</span>
      <small>${block.description}</small>
    </button>`).join("");
}

function latestReportSession() {
  const sessions = Object.values(readJson(STORE.sessions, {})).filter((s) => s.report);
  return sessions.sort((a, b) => {
    const ad = a.deck.submittedAt || a.deck.createdAt || a.deck.dateKey;
    const bd = b.deck.submittedAt || b.deck.createdAt || b.deck.dateKey;
    return bd.localeCompare(ad);
  })[0];
}

async function googleLogin() {
  const cfg = window.KHUSHI_CAT_CONFIG || {};
  if (!cfg.firebase?.apiKey || !window.firebase) {
    alert("Firebase is not ready yet. Using Khushi local profile for now.");
    localLogin();
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
    firebaseReady = true;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    let result;
    try {
      result = await firebase.auth().signInWithPopup(provider);
    } catch (popupError) {
      console.warn("Popup sign-in failed, trying redirect", popupError);
      await firebase.auth().signInWithRedirect(provider);
      return;
    }
    user = {
      name: result.user.displayName || "Khushi",
      email: result.user.email || "",
      uid: result.user.uid,
      mode: "google"
    };
    writeJson(STORE.user, user);
    $("logoutBtn").classList.remove("hidden");
    renderHome();
    show("homeScreen");
  } catch (err) {
    console.error(err);
    alert(`Google login failed: ${err.code || ""} ${err.message || ""}\n\nMake sure Google sign-in is enabled in Firebase Authentication and this domain is authorized.`);
  }
}

function localLogin() {
  user = { name: "Khushi", mode: "local" };
  writeJson(STORE.user, user);
  $("logoutBtn").classList.remove("hidden");
  renderHome();
  show("homeScreen");
}

function boot() {
  const cfg = window.KHUSHI_CAT_CONFIG || {};
  if (cfg.firebase?.apiKey && window.firebase) {
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
      firebaseReady = true;
      firebase.auth().onAuthStateChanged((fbUser) => {
        if (!fbUser) return;
        user = {
          name: fbUser.displayName || "Khushi",
          email: fbUser.email || "",
          uid: fbUser.uid,
          mode: "google"
        };
        writeJson(STORE.user, user);
        $("logoutBtn").classList.remove("hidden");
        renderHome();
        show("homeScreen");
      });
      firebase.auth().getRedirectResult().then((result) => {
        if (!result?.user) return;
        user = {
          name: result.user.displayName || "Khushi",
          email: result.user.email || "",
          uid: result.user.uid,
          mode: "google"
        };
        writeJson(STORE.user, user);
        $("logoutBtn").classList.remove("hidden");
        renderHome();
        show("homeScreen");
      }).catch((err) => {
        console.warn("Redirect login failed", err);
      });
    } catch (err) {
      console.warn("Firebase init skipped", err);
    }
  }
  user = readJson(STORE.user, null);
  if (user) {
    $("logoutBtn").classList.remove("hidden");
    renderHome();
    show("homeScreen");
  }
}

$("googleBtn").onclick = googleLogin;
$("localBtn").onclick = localLogin;
$("logoutBtn").onclick = async () => {
  if (firebaseReady && window.firebase?.auth) {
    try { await firebase.auth().signOut(); } catch {}
  }
  localStorage.removeItem(STORE.user);
  location.reload();
};
$("mainMenuBtn").onclick = () => { renderHome(); show(user ? "homeScreen" : "loginScreen"); };
$("historyBtn").onclick = () => { renderHistory(); show("historyScreen"); };
$("backHomeBtn").onclick = () => { renderHome(); show("homeScreen"); };
$("reportBtn").onclick = () => {
  const s = latestReportSession();
  if (!s) {
    alert("No completed report yet. Finish a block first.");
    return;
  }
  deck = s.deck; responses = s.responses || {};
  renderReport(s.report);
  show("reportScreen");
};
$("previewBtn").onclick = () => alert("Daily target till 29 Nov 2026: Morning VARC: 4 passages, Morning DILR: 3 sets, Evening DILR: 2 sets, Evening Quant: 30 questions. Each block locks after completion and resets the next day.");
$("taskGrid").onclick = (e) => {
  const card = e.target.closest("[data-block]");
  if (!card || card.disabled) return;
  startSession(card.dataset.block);
};
$("optionsPanel").onclick = (e) => {
  const b = e.target.closest("[data-option]");
  if (b) selectOption(Number(b.dataset.option));
};
$("prevBtn").onclick = () => { if (activeIndex > 0) { activeIndex--; renderQuestion(); } };
$("nextBtn").onclick = () => { if (activeIndex < deck.questions.length - 1) { activeIndex++; renderQuestion(); } };
$("clearBtn").onclick = () => { delete responses[deck.questions[activeIndex].id]; renderQuestion(); };
$("finishBtn").onclick = finishSession;
$("pauseBtn").onclick = () => { paused = true; saveCurrentSession(); show("pausedScreen"); };
$("resumeBtn").onclick = () => { paused = false; show("testScreen"); renderQuestion(); };
$("reviewBtn").onclick = () => { renderReview(); show("reviewScreen"); };
$("backReportBtn").onclick = () => { renderReport(makeReport()); show("reportScreen"); };
$("emailReportBtn").onclick = sendEmailReport;
$("pdfReportBtn").onclick = downloadPdfReport;

boot();
