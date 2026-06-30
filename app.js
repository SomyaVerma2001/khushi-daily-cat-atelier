const START_DATE = "2026-06-30";
const CAT_DATE = "2026-11-29";
const QUESTION_BANK_VERSION = "2026-06-30-expanded-bank-v1";
const DAILY_REQUIREMENTS = {
  varcPassages: 4,
  dilrSets: 5,
  quantQuestions: 30
};
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
  while (set.size < 4) set.add(fallbackOption(answer, guard++));
  const options = shuffle(rand, [...set].slice(0, 4));
  return { options, answer: options.indexOf(String(answer)) };
}

function fallbackOption(answer, guard) {
  const raw = String(answer);
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return String(numeric + guard);
  const unitMatch = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (unitMatch) {
    const next = Number(unitMatch[1]) + guard;
    return `${Number(next.toFixed(2))}${unitMatch[2]}`;
  }
  return ["Cannot be determined", "None of these", "Insufficient information", "All of these"][guard % 4];
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

function totalPrepDays() {
  return Math.max(0, daysBetween(START_DATE, CAT_DATE) + 1);
}

function realBankTargets() {
  const days = totalPrepDays();
  return {
    days,
    varcPassages: days * DAILY_REQUIREMENTS.varcPassages,
    dilrSets: days * DAILY_REQUIREMENTS.dilrSets,
    quantQuestions: days * DAILY_REQUIREMENTS.quantQuestions,
    totalQuestions: days * (
      DAILY_REQUIREMENTS.varcPassages * 4 +
      DAILY_REQUIREMENTS.dilrSets * 4 +
      DAILY_REQUIREMENTS.quantQuestions
    )
  };
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

function optionLabel(index, total = 4) {
  return total === 5 ? String(index + 1) : letters[index];
}

function textOnly(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  return (template.content.textContent || "").replace(/\s+/g, " ").trim();
}

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  $("pauseBtn").classList.toggle("hidden", id !== "testScreen");
}

function makeQuestion({ id, bankSlot = "", section, setTitle, topic, difficulty, passageHtml = "", visualHtml = "", question, options, answer, solution }) {
  return { id, bankSlot: bankSlot || id, section, setTitle, topic, difficulty, passageHtml, visualHtml, question, options, answer, solution };
}

function makeQuant(seed, index) {
  const rand = rng(seed + index * 982451653);
  const type = index % 20;
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

  if (type === 9) {
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

  if (type === 10) {
    const a = pick(rand, [3, 4, 5, 7]);
    const b = pick(rand, [5, 7, 8, 9]);
    const k = pick(rand, [6, 8, 10, 12]);
    const extra = pick(rand, [18, 24, 30, 36]);
    const total = (a + b) * k + extra;
    const x = (total - extra) / (a + b);
    const ans = a * x;
    const opts = optionize(rand, ans, [b * x, ans + extra / 2, Math.max(1, ans - extra / 3)]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Ratio and Proportion", difficulty: "Moderate-Difficult",
      question: `Two quantities are in the ratio ${a}:${b}. If their sum is increased by ${extra}, the new total becomes ${total}. What was the smaller original quantity?`,
      ...opts,
      solution: `Original sum \\(=${total}-${extra}=${total - extra}\\). One ratio unit \\(=\\frac{${total - extra}}{${a + b}}=${x}\\). Smaller quantity \\(=${a}\\times ${x}=${ans}\\).`
    });
  }

  if (type === 11) {
    const n1 = pick(rand, [24, 30, 36, 40]);
    const avg1 = pick(rand, [42, 46, 50, 54]);
    const n2 = pick(rand, [16, 20, 24, 30]);
    const avg2 = avg1 + pick(rand, [8, 10, 12, 15]);
    const ans = Number(((n1 * avg1 + n2 * avg2) / (n1 + n2)).toFixed(2));
    const opts = optionize(rand, ans, [Number(((avg1 + avg2) / 2).toFixed(2)), Number((ans + 2).toFixed(2)), Number((ans - 2).toFixed(2))]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Averages", difficulty: "Moderate-Difficult",
      question: `A batch of ${n1} students has average score ${avg1}. Another batch of ${n2} students has average score ${avg2}. What is the combined average?`,
      ...opts,
      solution: `Combined average \\(=\\frac{${n1}\\times${avg1}+${n2}\\times${avg2}}{${n1}+${n2}}=${ans}\\). Weighted average is required, not simple average of averages.`
    });
  }

  if (type === 12) {
    const divisor = pick(rand, [7, 9, 11, 13]);
    const remainder = pick(rand, [2, 3, 4, 5]);
    const count = pick(rand, [21, 24, 27, 30]);
    const n = divisor * count + remainder;
    const ans = n % (divisor - 2);
    const opts = optionize(rand, ans, [(n + remainder) % (divisor - 2), (n - remainder) % (divisor - 2), remainder]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Remainders", difficulty: "Difficult",
      question: `A positive integer \\(N\\) leaves remainder ${remainder} when divided by ${divisor}, and \\(N\\) lies between ${divisor * (count - 1)} and ${divisor * (count + 1)}. What remainder does \\(N\\) leave when divided by ${divisor - 2}?`,
      ...opts,
      solution: `The only matching value in the interval is \\(N=${divisor}\\times${count}+${remainder}=${n}\\). Dividing ${n} by ${divisor - 2} leaves remainder ${ans}.`
    });
  }

  if (type === 13) {
    const first = pick(rand, [5, 7, 9, 11]);
    const diff = pick(rand, [3, 4, 5, 6]);
    const terms = pick(rand, [12, 15, 18, 20]);
    const ans = terms * (2 * first + (terms - 1) * diff) / 2;
    const opts = optionize(rand, ans, [ans + terms * diff, ans - terms * diff, first * terms]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Sequences and Series", difficulty: "Moderate",
      question: `An arithmetic progression has first term ${first} and common difference ${diff}. What is the sum of its first ${terms} terms?`,
      ...opts,
      solution: `AP sum \\(S_n=\\frac{n}{2}[2a+(n-1)d]\\). So \\(S=${terms}/2[2(${first})+${terms - 1}(${diff})]=${ans}\\).`
    });
  }

  if (type === 14) {
    const consonants = pick(rand, [4, 5, 6]);
    const vowels = pick(rand, [3, 4]);
    const total = consonants + vowels;
    const ans = factorial(consonants) * factorial(vowels) * 2;
    const opts = optionize(rand, ans, [factorial(total), factorial(consonants) * factorial(vowels), ans * 2]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Permutations with Restrictions", difficulty: "Difficult",
      question: `A word has ${consonants} distinct consonants and ${vowels} distinct vowels. In how many arrangements are all vowels together and all consonants together?`,
      ...opts,
      solution: `Treat vowels as one block and consonants as one block: the two blocks can be ordered in \\(2!\\) ways. Internal arrangements are \\(${vowels}!\\) and \\(${consonants}!\\). Total \\(=2\\times${vowels}!\\times${consonants}!=${ans}\\).`
    });
  }

  if (type === 15) {
    const x1 = pick(rand, [1, 2, 3, 4]);
    const y1 = pick(rand, [2, 3, 5, 7]);
    const dx = pick(rand, [3, 4, 5, 6]);
    const dy = pick(rand, [4, 6, 8, 10]);
    const ans = Number(Math.sqrt(dx * dx + dy * dy).toFixed(2));
    const opts = optionize(rand, ans, [dx + dy, Number((ans + 1).toFixed(2)), Number((ans - 1).toFixed(2))]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Coordinate Geometry", difficulty: "Moderate",
      question: `What is the distance between points \\((${x1},${y1})\\) and \\((${x1 + dx},${y1 + dy})\\)?`,
      ...opts,
      solution: `Distance \\(=\\sqrt{(${dx})^2+(${dy})^2}=\\sqrt{${dx * dx + dy * dy}}=${ans}\\).`
    });
  }

  if (type === 16) {
    const h = pick(rand, [2, 3, 4, 5]);
    const k = pick(rand, [12, 16, 20, 25]);
    const ans = k;
    const opts = optionize(rand, ans, [k - h, k + h, h * k]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Functions and Graphs", difficulty: "Difficult",
      question: `For real \\(x\\), what is the maximum value of \\(- (x-${h})^2 + ${k}\\)?`,
      ...opts,
      solution: `Since \\((x-${h})^2\\ge 0\\), the expression is maximum when \\(x=${h}\\). Maximum value \\(=${k}\\).`
    });
  }

  if (type === 17) {
    const fillA = pick(rand, [12, 15, 18, 20]);
    const fillB = pick(rand, [18, 20, 24, 30]);
    const leak = pick(rand, [36, 40, 45, 60]);
    const rate = 1 / fillA + 1 / fillB - 1 / leak;
    const ans = Number((1 / rate).toFixed(2));
    const opts = optionize(rand, ans, [Number((fillA * fillB / (fillA + fillB)).toFixed(2)), Number((ans + 3).toFixed(2)), Number((ans - 3).toFixed(2))]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Pipes and Cisterns", difficulty: "Difficult",
      question: `Pipe A fills a tank in ${fillA} hours, pipe B fills it in ${fillB} hours, and a leak empties it in ${leak} hours. If all are opened together, how long will the tank take to fill?`,
      ...opts,
      solution: `Net rate \\(=\\frac{1}{${fillA}}+\\frac{1}{${fillB}}-\\frac{1}{${leak}}=${rate.toFixed(4)}\\). Time \\(=\\frac{1}{\\text{net rate}}=${ans}\\) hours.`
    });
  }

  if (type === 18) {
    const radius = pick(rand, [3, 4, 5, 6, 7]);
    const height = pick(rand, [8, 10, 12, 14]);
    const ans = `${radius * radius * height}π`;
    const opts = optionize(rand, ans, [`${2 * radius * height}π`, `${radius * height}π`, `${radius * radius * (height + 1)}π`]);
    return makeQuestion({
      id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Mensuration", difficulty: "Moderate",
      question: `A cylinder has radius ${radius} cm and height ${height} cm. What is its volume?`,
      ...opts,
      solution: `Cylinder volume \\(=\\pi r^2h=\\pi\\times${radius}^2\\times${height}=${radius * radius * height}\\pi\\).`
    });
  }

  const a = pick(rand, [45, 50, 55, 60]);
  const b = pick(rand, [40, 45, 50, 55]);
  const both = pick(rand, [18, 20, 22, 25]);
  const total = a + b - both + pick(rand, [12, 15, 18, 24, 30]);
  const neither = total - (a + b - both);
  const opts = optionize(rand, neither, [neither + 4, Math.max(0, neither - 4), both]);
  return makeQuestion({
    id, section: "Quant", setTitle: "Quantitative Aptitude", topic: "Set Theory", difficulty: "Moderate-Difficult",
    question: `In a group of ${total} students, ${a} like Algebra, ${b} like Geometry, and ${both} like both. How many like neither Algebra nor Geometry?`,
    ...opts,
    solution: `Students liking at least one \\(=${a}+${b}-${both}=${a + b - both}\\). Neither \\(=${total}-${a + b - both}=${neither}\\).`
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
  {
    topic: "algorithmic taste",
    anchor: "streaming platforms, shopping feeds, and recommendation engines",
    example: "A listener who once wandered through unfamiliar albums may now meet music as a sequence of risk-managed predictions.",
    tension: "The problem is not that recommendation is artificial, but that it can quietly replace exploration with a comfortingly narrow version of one's past behaviour.",
    concession: "Yet a human curator is not automatically freer or fairer; curators also carry habits, prejudices, and commercial pressures.",
    conclusion: "The better question is whether the system leaves room for deliberate surprise."
  },
  {
    topic: "urban memory",
    anchor: "flyovers, glass offices, renovated markets, and heritage walks",
    example: "A lane that looks inefficient to a planner may be the same lane by which residents remember seasons, occupations, festivals, and quarrels.",
    tension: "When redevelopment treats memory as decorative, it preserves a signboard while removing the practices that made the signboard intelligible.",
    concession: "No city can become a museum without becoming hostile to the people who still need housing, transport, and work.",
    conclusion: "A liveable city must therefore change without pretending that all traces are equally replaceable."
  },
  {
    topic: "scientific models",
    anchor: "climate simulations, economic forecasts, and simplified laboratory systems",
    example: "A map that records every stone would be useless for navigation; a model that records every variable can become equally unhelpful.",
    tension: "Simplification becomes dangerous only when its omissions are forgotten and the model begins to pose as the world itself.",
    concession: "But rejecting simplification altogether is merely another way of refusing to think with discipline.",
    conclusion: "The virtue of a model lies in knowing exactly what question it is allowed to answer."
  },
  {
    topic: "workplace speed",
    anchor: "instant messages, dashboards, read receipts, and productivity rituals",
    example: "A reply sent in ninety seconds may display attentiveness while postponing the slower act of understanding what the problem actually is.",
    tension: "Speed is seductive because it produces evidence of effort even when it prevents the kind of attention that would reduce effort later.",
    concession: "There are emergencies in which delay is not wisdom but evasion.",
    conclusion: "The mature workplace distinguishes urgency from mere visibility."
  },
  {
    topic: "museum silence",
    anchor: "labels, lighting, empty space, glass cases, and visitor routes",
    example: "The quiet of a gallery can make an object seem self-evident, although every angle and label has already instructed the visitor how to look.",
    tension: "Neutral presentation often works by hiding the choices through which neutrality is manufactured.",
    concession: "This does not mean curation is manipulation in a crude sense; selection is unavoidable whenever attention is limited.",
    conclusion: "The honest museum teaches visitors to notice the frame as well as the object."
  },
  {
    topic: "education metrics",
    anchor: "rankings, cut-offs, percentiles, dashboards, and standardised tests",
    example: "A score can reveal a weakness that praise would politely ignore, but it can also persuade a student that only scored weaknesses are real.",
    tension: "Measurement sharpens effort by narrowing it, and the narrowing becomes harmful when it is mistaken for the whole of learning.",
    concession: "Teachers who dismiss measurement entirely often leave students with vague encouragement and little diagnosis.",
    conclusion: "The issue is not whether to measure, but whether measurement remains a servant of learning."
  },
  {
    topic: "ecological restoration",
    anchor: "rewilding projects, river clean-ups, seed banks, and managed forests",
    example: "Planting an old species list in a changed climate may honour history while ignoring the altered conditions under which living systems must now survive.",
    tension: "Restoration fails when it imagines repair as the cancellation of time.",
    concession: "Still, novelty by itself is not a principle; damaged landscapes need memory as well as adaptation.",
    conclusion: "Repair is best understood as disciplined improvisation rather than return."
  },
  {
    topic: "language change",
    anchor: "new pronouns, borrowed slang, professional jargon, and online abbreviations",
    example: "Every generation hears decay in the speech of the next, partly because language makes social change audible before it becomes respectable.",
    tension: "The wish to freeze language often disguises a wish to freeze the authority of those already fluent in its older forms.",
    concession: "Not every new phrase is precise, beautiful, or worth keeping.",
    conclusion: "A language survives because communities argue over use, not because a committee arrests it."
  },
  {
    topic: "digital privacy",
    anchor: "fitness trackers, payment trails, smart cameras, and location histories",
    example: "A person may consent to share a step count without noticing that the same data can reveal routines, absences, illnesses, and anxieties.",
    tension: "Privacy is weakened less by one dramatic exposure than by the gradual normalisation of being legible to institutions.",
    concession: "Data can make services safer, faster, and more responsive when its use is narrow and accountable.",
    conclusion: "The defence of privacy is therefore a defence of meaningful limits, not secrecy for its own sake."
  },
  {
    topic: "public libraries",
    anchor: "quiet reading rooms, digital catalogues, community classes, and borrowed devices",
    example: "A library that lends internet access may be preserving the spirit of reading more faithfully than one that merely protects shelves.",
    tension: "If libraries are judged only by book circulation, their civic function becomes invisible precisely when it is most needed.",
    concession: "A library cannot become every public service at once without losing focus and competence.",
    conclusion: "Its future depends on treating access to attention as seriously as access to information."
  },
  {
    topic: "remote work",
    anchor: "video calls, shared documents, home offices, and asynchronous updates",
    example: "A worker freed from commuting can also become a worker whose day has no obvious edge.",
    tension: "Flexibility becomes a burden when the institution keeps the freedom but transfers the coordination cost to the individual.",
    concession: "For many people, remote work has made participation possible where office routines once excluded them.",
    conclusion: "The humane test of remote work is whether autonomy is matched by explicit norms."
  },
  {
    topic: "food authenticity",
    anchor: "regional recipes, fusion restaurants, family kitchens, and tourism menus",
    example: "A dish can be called authentic because it is old, because it is local, or because it satisfies an outsider's expectation of localness.",
    tension: "Authenticity becomes suspect when it turns living practice into a performance for consumers.",
    concession: "Borrowing and adaptation are not betrayals; cuisines have always travelled through trade, migration, and scarcity.",
    conclusion: "Food traditions survive through negotiated continuity rather than purity."
  },
  {
    topic: "sports analytics",
    anchor: "player dashboards, win-probability models, scouting databases, and wearable sensors",
    example: "A coach who trusts only the eye may miss patterns, while a coach who trusts only the model may miss courage, fatigue, or fear.",
    tension: "Numbers are most dangerous not when they are wrong, but when they appear complete.",
    concession: "Analytics has corrected many sentimental myths about talent and performance.",
    conclusion: "The best sporting judgment lets measurement discipline intuition without replacing it."
  },
  {
    topic: "artificial intelligence in education",
    anchor: "essay assistants, tutoring bots, plagiarism detectors, and adaptive quizzes",
    example: "A student can receive instant feedback and still never learn how to sit with confusion long enough to form a question.",
    tension: "Automation can improve instruction while hollowing out the apprenticeship through which judgment is learned.",
    concession: "Denying students access to powerful tools rarely teaches integrity; it often teaches evasion.",
    conclusion: "Education must redesign tasks around thinking, not merely police the tools used to complete them."
  },
  {
    topic: "memory and photography",
    anchor: "phone galleries, cloud backups, staged portraits, and disappearing stories",
    example: "People now document experiences partly to remember them and partly to prove that they were worth remembering.",
    tension: "The camera can preserve a moment while also teaching the subject to experience the moment as future evidence.",
    concession: "Photographs have always shaped memory; there was no innocent era of pure recollection.",
    conclusion: "The question is whether documentation deepens attention or merely replaces it."
  },
  {
    topic: "market efficiency",
    anchor: "dynamic pricing, ratings platforms, delivery apps, and algorithmic matching",
    example: "A marketplace can reduce search costs while making every participant constantly measurable and replaceable.",
    tension: "Efficiency becomes impoverished when it counts only completed transactions and not the forms of dependence they create.",
    concession: "Slow, opaque markets often protected insiders and punished newcomers.",
    conclusion: "A fair market must be judged by the bargaining power it leaves behind, not just the speed it produces."
  },
  {
    topic: "archaeological interpretation",
    anchor: "fragments of pottery, burial sites, inscriptions, and reconstructed settlements",
    example: "A broken vessel may tell us less about what happened than about what modern scholars are trained to consider evidence.",
    tension: "The past is vulnerable to being made coherent by the needs of the present.",
    concession: "Interpretation is not optional; mute objects do not organise themselves into history.",
    conclusion: "Good archaeology is disciplined imagination constrained by material resistance."
  },
  {
    topic: "climate adaptation",
    anchor: "sea walls, heat shelters, crop shifts, and managed retreat",
    example: "A city that builds higher barriers may be adapting to risk while postponing a conversation about where people should live.",
    tension: "Adaptation can become a comforting word for accepting unequal exposure to danger.",
    concession: "Refusing adaptation because mitigation is morally urgent would leave vulnerable people unprotected.",
    conclusion: "The ethical challenge is to adapt without making injustice look like resilience."
  },
  {
    topic: "translation",
    anchor: "subtitles, bilingual editions, machine translation, and literary prizes",
    example: "A translated poem may fail by being too literal or by being so fluent that it erases the pressure of another language.",
    tension: "Translation is judged unfairly when fidelity is imagined as the absence of interpretation.",
    concession: "A translator cannot preserve every rhythm, joke, ambiguity, and cultural echo at once.",
    conclusion: "A good translation is not a window without glass but a carefully made lens."
  },
  {
    topic: "consumer minimalism",
    anchor: "decluttered homes, capsule wardrobes, productivity blogs, and lifestyle branding",
    example: "Owning fewer things can free attention, but it can also become another way of purchasing a cleaner identity.",
    tension: "Minimalism becomes contradictory when it turns restraint into a status object.",
    concession: "There is real relief in refusing needless accumulation and the debt that often sustains it.",
    conclusion: "The value of simplicity depends on whether it reduces performance or merely changes its costume."
  },
  {
    topic: "medical diagnosis",
    anchor: "scan results, symptom checkers, clinical interviews, and risk scores",
    example: "A clear scan can reassure a patient while failing to explain the pain that brought the patient to the clinic.",
    tension: "Medicine loses something when evidence that is easy to record displaces evidence that is difficult to hear.",
    concession: "Romanticising bedside intuition would be dangerous; tests have corrected countless confident errors.",
    conclusion: "Good diagnosis joins measurement with attention to the story in which symptoms occur."
  },
  {
    topic: "financial literacy",
    anchor: "budgeting apps, credit scores, investment reels, and classroom modules",
    example: "Teaching a person compound interest is useful, but it does not by itself create wages, security, or bargaining power.",
    tension: "Financial literacy can become a way of individualising problems that are partly structural.",
    concession: "Knowledge still matters; ignorance makes exploitation easier and recovery harder.",
    conclusion: "The strongest financial education links personal skill with institutional awareness."
  },
  {
    topic: "scientific peer review",
    anchor: "anonymous reports, journal rankings, replication checks, and preprint servers",
    example: "A paper can be rejected because it is weak, because it is unfamiliar, or because reviewers mistake convention for rigour.",
    tension: "Peer review protects knowledge by slowing it down, but the same slowness can protect hierarchy.",
    concession: "Removing review altogether would not create openness; it would shift trust to noisier signals.",
    conclusion: "The challenge is to make scrutiny more transparent without making it performative."
  },
  {
    topic: "tourism and place",
    anchor: "heritage districts, photo spots, guided walks, and short-term rentals",
    example: "A neighbourhood can become famous for the very texture that tourism then prices out of daily life.",
    tension: "Tourism often preserves the image of a place while weakening the conditions that produced it.",
    concession: "Visitors can bring income, attention, and political support for conservation.",
    conclusion: "A place is not protected if only its visitor-facing surface survives."
  },
  {
    topic: "attention economy",
    anchor: "notifications, infinite scroll, creator metrics, and personalised feeds",
    example: "A platform can claim to offer choice while designing the environment in which choosing becomes exhausting.",
    tension: "Attention is captured most effectively when capture feels like self-expression.",
    concession: "People are not passive victims; they use platforms for learning, friendship, and livelihood.",
    conclusion: "The politics of attention begins with asking who profits from interrupted thought."
  },
  {
    topic: "legal precedent",
    anchor: "court judgments, dissenting opinions, statutory interpretation, and constitutional disputes",
    example: "A precedent can stabilise law while carrying forward the assumptions of a less democratic moment.",
    tension: "Respect for continuity becomes troubling when continuity shields an error from fresh reasoning.",
    concession: "A legal system that revises every question from scratch would become arbitrary and slow.",
    conclusion: "The authority of precedent depends on the quality of the reasons it keeps alive."
  },
  {
    topic: "childhood play",
    anchor: "scheduled activities, playground design, screen games, and parental monitoring",
    example: "A child may be safer in a supervised activity and yet have fewer chances to negotiate risk independently.",
    tension: "Protection becomes excessive when it removes the small uncertainties through which agency develops.",
    concession: "Appeals to freedom can ignore real dangers and unequal neighbourhood conditions.",
    conclusion: "Good play environments stage risk without abandoning care."
  },
  {
    topic: "open-source software",
    anchor: "public repositories, volunteer maintainers, issue trackers, and corporate dependencies",
    example: "A company may celebrate openness while relying on unpaid maintenance it would never leave unfunded internally.",
    tension: "The gift economy of code becomes strained when gratitude substitutes for responsibility.",
    concession: "Open collaboration has produced tools no single firm would have imagined or sustained.",
    conclusion: "The future of open source depends on matching shared benefit with shared upkeep."
  },
  {
    topic: "cultural awards",
    anchor: "literary prizes, film festivals, jury citations, and bestseller lists",
    example: "An award can reveal neglected work and also teach audiences which forms of seriousness are fashionable.",
    tension: "Recognition changes the field it claims merely to observe.",
    concession: "Without institutions of attention, many difficult works would disappear quietly.",
    conclusion: "Awards are useful when treated as arguments, not verdicts."
  },
  {
    topic: "rural development",
    anchor: "roads, mobile banking, irrigation schemes, and migration corridors",
    example: "A new road may connect a village to markets while also accelerating the departure of its young workers.",
    tension: "Development indicators can rise while the social meaning of staying becomes harder to defend.",
    concession: "Romanticising rural life can excuse deprivation and limited opportunity.",
    conclusion: "Development should expand choices without quietly declaring one way of life obsolete."
  },
  {
    topic: "news credibility",
    anchor: "fact-checks, viral clips, anonymous sources, and subscription newsletters",
    example: "A corrected falsehood may travel less widely than the emotion that made it believable.",
    tension: "Credibility cannot be repaired only at the level of facts when mistrust is social and emotional.",
    concession: "Facts still matter; cynicism about all reporting simply rewards the loudest manipulator.",
    conclusion: "Trustworthy news must make its methods visible as well as its conclusions."
  },
  {
    topic: "craft and automation",
    anchor: "handmade goods, CNC machines, design software, and maker workshops",
    example: "A chair cut by a machine may still embody craft if the maker understands the material, use, and constraint.",
    tension: "Craft is cheapened when it is reduced either to hand labour or to luxury branding.",
    concession: "Automation can remove drudgery and make precision available to more people.",
    conclusion: "Craft is best understood as accountable judgment in making."
  },
  {
    topic: "university rankings",
    anchor: "citation counts, employer surveys, international faculty ratios, and placement data",
    example: "A department may improve its rank by becoming more legible to ranking systems rather than more useful to students.",
    tension: "Rankings govern behaviour because they turn complex missions into competitive simplicity.",
    concession: "Some comparison is necessary; opacity can shelter mediocrity and exclusion.",
    conclusion: "The danger lies in mistaking a proxy for the institution's purpose."
  },
  {
    topic: "migration narratives",
    anchor: "remittances, border policies, language classes, and diasporic festivals",
    example: "A migrant can be praised as resilient while the conditions requiring resilience remain unquestioned.",
    tension: "Stories of success may console the receiving society by turning structural hardship into personal virtue.",
    concession: "Agency is real; migrants are not merely victims of policy or economy.",
    conclusion: "A truthful migration narrative must hold ambition and constraint together."
  },
  {
    topic: "environmental accounting",
    anchor: "carbon offsets, ESG reports, biodiversity credits, and supply-chain audits",
    example: "A company can count trees planted more easily than communities displaced or water tables altered.",
    tension: "Accounting can make responsibility visible, but it can also make only the countable seem responsible.",
    concession: "Without measurement, environmental promises often dissolve into public relations.",
    conclusion: "The best accounting systems reveal uncertainty instead of hiding it behind precision."
  },
  {
    topic: "discipline in learning",
    anchor: "timetables, streak counters, mock tests, and revision notebooks",
    example: "A student may protect a study streak even when the streak has stopped protecting understanding.",
    tension: "Discipline becomes hollow when consistency is preserved after purpose has vanished.",
    concession: "Waiting for motivation is a poor strategy; habits carry effort across ordinary resistance.",
    conclusion: "A useful discipline remains answerable to learning rather than appearance."
  },
  {
    topic: "public transport design",
    anchor: "metro maps, feeder buses, fare cards, and last-mile services",
    example: "A city may build a fast line that remains socially slow for anyone who cannot reach the station safely.",
    tension: "Transport equity is often lost in the gap between network efficiency and door-to-door experience.",
    concession: "Large systems require abstraction; planners cannot design every trip as a special case.",
    conclusion: "Good transport planning measures the journey people actually make."
  },
  {
    topic: "digital archives",
    anchor: "scanned manuscripts, metadata tags, search boxes, and preservation servers",
    example: "A searchable archive can rescue forgotten material while making what is untagged newly invisible.",
    tension: "Digitisation changes access by changing the questions users are likely to ask.",
    concession: "Physical archives were never neutral; distance, permission, and fragility shaped scholarship long before search engines.",
    conclusion: "An archive's openness depends on the design of discovery as much as on the volume of material."
  },
  {
    topic: "philanthropy",
    anchor: "foundation grants, impact metrics, naming rights, and charitable campaigns",
    example: "A donor may solve a visible problem while gaining influence over which problems become visible.",
    tension: "Generosity becomes politically complicated when private preference sets public priority.",
    concession: "Many institutions and communities survive because philanthropic money arrives where public systems fail.",
    conclusion: "The ethics of giving includes accountability for the power that giving creates."
  },
  {
    topic: "professional expertise",
    anchor: "consultants, certification exams, expert panels, and public advice",
    example: "An expert can simplify responsibly for a lay audience or simplify so much that uncertainty disappears.",
    tension: "Expertise loses legitimacy when it demands trust while concealing its limits.",
    concession: "Anti-expert suspicion often mistakes confidence for arrogance and complexity for deception.",
    conclusion: "A healthy public culture needs experts who can explain both knowledge and doubt."
  },
  {
    topic: "workplace diversity",
    anchor: "hiring targets, mentorship programmes, inclusion surveys, and promotion panels",
    example: "An organisation can diversify entry-level hiring while leaving the grammar of leadership unchanged.",
    tension: "Representation becomes thin when difference is welcomed only after it has been trained not to disturb norms.",
    concession: "Numbers are not meaningless; without them, institutions often narrate progress they have not made.",
    conclusion: "Inclusion is tested by who gets to reshape the standard of merit."
  },
  {
    topic: "risk communication",
    anchor: "weather warnings, health advisories, probability charts, and emergency alerts",
    example: "A forecast that is statistically accurate can still fail if people do not understand what action it demands.",
    tension: "Risk is not communicated merely by stating likelihood; it must be translated into practical consequence.",
    concession: "Over-simplifying danger can produce panic or complacency.",
    conclusion: "Good warnings respect both evidence and the conditions under which people decide."
  },
  {
    topic: "literary canon",
    anchor: "school syllabi, anthologies, footnotes, and examination passages",
    example: "A text enters the canon not only because it is read, but because institutions keep arranging occasions to reread it.",
    tension: "The canon becomes oppressive when durability is mistaken for universal value.",
    concession: "Discarding inherited works wholesale can flatten the very arguments through which culture understands itself.",
    conclusion: "A living canon is revised through serious encounter, not simple replacement."
  },
  {
    topic: "startup culture",
    anchor: "pitch decks, growth charts, founder stories, and burn-rate dashboards",
    example: "A firm can call every constraint temporary while building a culture that treats exhaustion as evidence of belief.",
    tension: "Optimism becomes managerial when it asks workers to absorb uncertainty as passion.",
    concession: "New ventures require risk; excessive caution would prevent many useful experiments.",
    conclusion: "Entrepreneurial energy is healthiest when ambition is separated from denial."
  },
  {
    topic: "citizen science",
    anchor: "bird counts, pollution sensors, open maps, and community labs",
    example: "A resident's measurement may be dismissed as amateur until it reveals what official instruments never looked for.",
    tension: "Participation is weakened when citizens collect data but professionals retain all interpretive authority.",
    concession: "Quality control matters; not every local observation is automatically reliable.",
    conclusion: "Citizen science works best when it shares both observation and question-making."
  },
  {
    topic: "time management",
    anchor: "calendar blocks, priority matrices, habit apps, and deep-work rituals",
    example: "A perfectly organised day can still protect the wrong work from interruption.",
    tension: "Time management fails when it treats attention as a scheduling problem but not a value problem.",
    concession: "Unstructured aspiration often collapses under ordinary demands.",
    conclusion: "The point of planning is not to fill time but to defend judgment about what deserves it."
  },
  {
    topic: "heritage conservation",
    anchor: "restored facades, adaptive reuse, plaques, and preservation laws",
    example: "A building can be saved as a facade while the life that made it historically meaningful is displaced.",
    tension: "Conservation becomes theatrical when it preserves appearance without social context.",
    concession: "Material traces matter; memory needs anchors that survive private convenience.",
    conclusion: "Heritage is most honest when it protects use, conflict, and continuity together."
  },
  {
    topic: "online education",
    anchor: "recorded lectures, discussion boards, auto-graded quizzes, and completion certificates",
    example: "A course can reach thousands while leaving each learner alone with the hardest part of learning.",
    tension: "Scale can distribute content faster than it can distribute mentorship.",
    concession: "For learners excluded by cost, geography, or time, online education can be transformative.",
    conclusion: "The measure of online learning is not access to videos but access to correction."
  }
];

function makeVarcSet(seed, passageIndex = 0) {
  const rand = rng(seed ^ 0xabcddcba);
  const t = pick(rand, varcThemes);
  const passage = `
    <p>Arguments about ${t.topic} are often conducted as if the choice were between reverence for the old and surrender to the new. That framing is convenient, because it allows each side to accuse the other of either sentimentality or blindness. It is also shallow. Most social and intellectual practices do not disappear in a single dramatic replacement; they are altered through small changes in attention, incentives, and vocabulary. By the time people notice that a practice has changed, the deeper bargain may already have been accepted as common sense.</p>
    <p>Consider ${t.anchor}. ${t.example} The visible gain is usually easy to describe: greater reach, faster access, cleaner comparison, or better coordination. The loss is harder to name because it is not always a loss of information. It is often a loss of occasions. A culture can retain the facts of an older practice while losing the situations in which people learnt how to judge, wait, interpret, or disagree. This is why complaints about change can sound exaggerated and still point toward something real.</p>
    <p>At the same time, the familiar past should not be granted moral immunity. Older arrangements excluded people, wasted effort, and hid their own forms of arbitrariness behind tradition. ${t.concession} A serious defence of judgment cannot depend on nostalgia, because nostalgia tends to remember the training and forget the gatekeeping. The question is not whether an older arrangement felt richer to those who were already at home in it; the question is what capacities a newer arrangement cultivates or weakens among those who must live inside it.</p>
    <p>This distinction matters because systems increasingly justify themselves through measurable convenience. Convenience is not trivial. It can democratise access and release attention for better uses. But convenience also has a political talent: it makes alternatives appear needlessly difficult. ${t.tension} When a practice becomes frictionless, people may lose not only the friction but also the reflective pause that friction accidentally created. The danger is therefore not change itself, but the disappearance of any shared language for asking what the change is training us to become.</p>
    <p>One way of testing a new arrangement, then, is to ask what kinds of mistakes it makes easy. A practice that makes people more efficient but less able to notice exceptions has not simply saved time; it has redistributed attention. A practice that widens participation while making every participant behave in the same predictable manner has not simply become inclusive; it has made inclusion conditional on conformity. These are not decisive objections, but they are the sort of costs that remain invisible when evaluation stops at convenience.</p>
    <p>${t.conclusion} Such a standard is deliberately modest. It does not demand that institutions preserve every old ritual, nor does it romanticise difficulty as a virtue. It asks instead for designs, policies, and habits that keep judgment visible. A society that can revise its tools while still examining the forms of attention those tools reward is less likely to confuse progress with mere smoothness.</p>
  `;
  const q1 = makeQuestion({
    id: `V-${seed}-1`, bankSlot: `VARC-${String(passageIndex + 1).padStart(4, "0")}-Q1`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Difficult",
    passageHtml: passage, question: "Which of the following best captures the central argument of the passage?",
    options: [
      `New arrangements around ${t.topic} should be resisted because they inevitably destroy older forms of judgment.`,
      `The real question about ${t.topic} is what habits of judgment a new arrangement preserves, weakens, or makes invisible.`,
      `Convenience is the only reliable measure by which changes in ${t.topic} should be judged.`,
      `Nostalgia is usually a more accurate guide than enthusiasm when institutions undergo change.`
    ],
    answer: 1,
    solution: `The passage is not anti-change and not pro-nostalgia. Its main concern is the kind of judgment and attention produced by new arrangements. Option B captures that balanced claim.`
  });
  const q2 = makeQuestion({
    id: `V-${seed}-2`, bankSlot: `VARC-${String(passageIndex + 1).padStart(4, "0")}-Q2`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Moderate-Difficult",
    passageHtml: passage, question: "According to the passage, why can complaints about change be exaggerated and still point toward something real?",
    options: [
      "Because every complaint about change contains reliable historical evidence.",
      "Because people may misdescribe the change while sensing a genuine loss of occasions for judgment or attention.",
      "Because older institutions were always more inclusive than newer ones.",
      "Because measurable convenience is never valuable in serious social practices."
    ],
    answer: 1,
    solution: `Paragraph 2 says critics may focus on visible replacements, but the subtler loss may be the disappearance of situations in which people practised judgment, patience, or interpretation.`
  });
  const q3 = makeQuestion({
    id: `V-${seed}-3`, bankSlot: `VARC-${String(passageIndex + 1).padStart(4, "0")}-Q3`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Difficult",
    passageHtml: passage, question: "Which of the following would most weaken the author's concern?",
    options: [
      `Evidence that the new arrangement in ${t.topic} makes access faster for a much larger population.`,
      `Evidence that users of the new arrangement become more reflective, independent, and capable of disagreement than users of the older arrangement.`,
      `Evidence that some defenders of the older arrangement were socially privileged.`,
      `Evidence that many people initially dislike new practices before adapting to them.`
    ],
    answer: 1,
    solution: `The author's worry is not speed or newness by itself; it is the weakening of judgment. Evidence that the new system strengthens judgment directly weakens the concern.`
  });
  const q4 = makeQuestion({
    id: `V-${seed}-4`, bankSlot: `VARC-${String(passageIndex + 1).padStart(4, "0")}-Q4`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Difficult",
    passageHtml: passage, question: "The phrase \"convenience also has a political talent\" most nearly means that convenience",
    options: [
      "can make one arrangement seem natural and alternatives seem unreasonable without openly arguing for that conclusion.",
      "is useful only when governments impose it through formal policy.",
      "always reduces inequality by making difficult practices easier for everyone.",
      "is a deceptive word for laziness and should therefore be rejected."
    ],
    answer: 0,
    solution: `The next sentence explains the phrase: convenience can make alternatives appear needlessly difficult. It shapes what people find reasonable without making an explicit argument.`
  });
  return [q1, q2, q3, q4];
}

function money(value) {
  return `Rs. ${Math.round(value).toLocaleString("en-IN")}`;
}

function pct(value) {
  return `${Number(value.toFixed(1))}%`;
}

function tableHtml(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function choiceSet(rand, correct, pool) {
  const set = new Set([String(correct)]);
  for (const value of shuffle(rand, pool.map(String))) {
    if (set.size === 4) break;
    set.add(value);
  }
  let guard = 1;
  while (set.size < 4) set.add(fallbackOption(correct, guard++));
  const options = shuffle(rand, [...set]);
  return { options, answer: options.indexOf(String(correct)) };
}

function maxBy(rows, fn) {
  return rows.reduce((best, row) => fn(row) > fn(best) ? row : best, rows[0]);
}

function minBy(rows, fn) {
  return rows.reduce((best, row) => fn(row) < fn(best) ? row : best, rows[0]);
}

const dilrGenericSchemas = [
  ["Retail Footfall", "store", ["Atria", "Beryl", "Crown", "Dune", "Elan", "Forum"], "weekday visitors", "weekend visitors", "conversion %", "bill value"],
  ["Clinic Queue", "clinic", ["North", "South", "East", "West", "Central", "Metro"], "appointments", "walk-ins", "completion %", "fee"],
  ["Warehouse Dispatch", "warehouse", ["Alpha", "Beta", "Gamma", "Delta", "Sigma", "Omega"], "orders", "returns", "dispatch %", "unit margin"],
  ["Mock Test Centres", "centre", ["Delhi", "Pune", "Surat", "Ranchi", "Kochi", "Jaipur"], "registered", "absent", "accuracy %", "score weight"],
  ["Subscription Cohorts", "cohort", ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], "new users", "churned", "active %", "monthly fee"],
  ["Factory Lines", "line", ["L1", "L2", "L3", "L4", "L5", "L6"], "planned units", "defects", "yield %", "profit/unit"],
  ["Library Programmes", "programme", ["Archives", "Coding", "Debate", "Design", "Finance", "Writing"], "registrations", "dropouts", "attendance %", "grant/unit"],
  ["Food Delivery Zones", "zone", ["Zone A", "Zone B", "Zone C", "Zone D", "Zone E", "Zone F"], "orders", "cancelled", "on-time %", "avg bill"],
  ["Scholarship Workshops", "workshop", ["Algebra", "Geometry", "VARC", "DILR", "Mocks", "GDPI"], "invited", "no-shows", "selection %", "award value"],
  ["Hotel Occupancy", "hotel", ["Iris", "Lotus", "Maple", "Orchid", "Pearl", "Willow"], "rooms", "vacant", "occupancy %", "tariff"],
  ["App Campaigns", "campaign", ["Search", "Social", "Email", "Referral", "Video", "Campus"], "leads", "invalid", "conversion %", "revenue/user"],
  ["Training Projects", "project", ["Apex", "Blaze", "Core", "Drift", "Edge", "Flux"], "tasks", "reopened", "closure %", "credit/task"],
  ["Exam Slots", "slot", ["Slot 1", "Slot 2", "Slot 3", "Slot 4", "Slot 5", "Slot 6"], "booked", "absent", "valid %", "fee"],
  ["Courier Routes", "route", ["R1", "R2", "R3", "R4", "R5", "R6"], "parcels", "failed", "same-day %", "charge"],
  ["Content Channels", "channel", ["Blog", "Shorts", "Podcast", "Webinar", "Newsletter", "Forum"], "views", "skips", "retention %", "value/view"],
  ["Hiring Pipelines", "pipeline", ["Analyst", "Sales", "Ops", "Product", "Tech", "Support"], "applications", "rejected", "interview %", "cost/hire"],
  ["Farm Produce", "market", ["Mandi A", "Mandi B", "Mandi C", "Mandi D", "Mandi E", "Mandi F"], "arrivals", "spoilage", "sold %", "price/unit"],
  ["Museum Visits", "gallery", ["Coins", "Textiles", "Maps", "Sculpture", "Scripts", "Paintings"], "visitors", "passes", "guided %", "ticket"],
  ["Energy Blocks", "block", ["B1", "B2", "B3", "B4", "B5", "B6"], "generated", "lost", "usable %", "rate"],
  ["Practice Groups", "group", ["G1", "G2", "G3", "G4", "G5", "G6"], "assigned", "skipped", "correct %", "marks/question"]
];

function makeDilrGenericSet(seed, setIndex, schema) {
  const rand = rng(seed ^ 0x71bd91f ^ setIndex);
  const [topic, label, names, rawName, lossName, rateName, valueName] = schema;
  const chosen = shuffle(rand, names).slice(0, 5);
  const rows = chosen.map((name, i) => {
    const raw = 110 + i * 23 + Math.floor(rand() * 45);
    const loss = pick(rand, [8, 11, 14, 17, 20, 23]);
    const rate = pick(rand, [54, 58, 62, 66, 70, 74, 78, 82]);
    const value = pick(rand, [90, 110, 125, 150, 180, 210, 240]) + i * 5;
    return { name, raw, loss, rate, value };
  });
  const eligible = (r) => r.raw - r.loss;
  const effective = (r) => Math.round(eligible(r) * r.rate / 100);
  const yieldValue = (r) => effective(r) * r.value;
  const efficiency = (r) => yieldValue(r) / r.raw;
  const headers = [label[0].toUpperCase() + label.slice(1), rawName, lossName, rateName, valueName];
  const table = tableHtml(headers, rows.map((r) => [r.name, r.raw, r.loss, `${r.rate}%`, money(r.value)]));
  const passage = `<p>The table gives data for five ${label}s. First remove ${lossName} from ${rawName}; then apply ${rateName} to the remaining count. Value is earned only on the effective count after this adjustment.</p>${table}`;
  const pool = rows.map((r) => r.name);
  const maxEffective = maxBy(rows, effective);
  const maxValue = maxBy(rows, yieldValue);
  const minEfficiency = minBy(rows, efficiency);
  const totalEffective = rows.reduce((s, r) => s + effective(r), 0);
  const totalOpts = optionize(rand, `${totalEffective}`, [`${totalEffective + 9}`, `${Math.max(1, totalEffective - 8)}`, `${totalEffective + 17}`]);
  return [
    makeQuestion({
      id: `D-${seed}-${setIndex}-G1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic, difficulty: "Moderate-Difficult",
      passageHtml: passage, question: `Which ${label} has the highest effective count after the adjustment?`, ...choiceSet(rand, maxEffective.name, pool),
      solution: `Effective count = (${rawName} - ${lossName}) × ${rateName}. ${maxEffective.name} is highest with ${effective(maxEffective)}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-G2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic, difficulty: "Difficult",
      passageHtml: passage, question: "What is the total effective count across all five rows?", ...totalOpts,
      solution: `Compute effective count row-wise after subtracting ${lossName}, then add all five values. Total effective count = ${totalEffective}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-G3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic, difficulty: "Difficult",
      passageHtml: passage, question: `Which ${label} generates the highest adjusted value?`, ...choiceSet(rand, maxValue.name, pool),
      solution: `Adjusted value = effective count × ${valueName}. ${maxValue.name} is highest: ${effective(maxValue)} × ${money(maxValue.value)} = ${money(yieldValue(maxValue))}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-G4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic, difficulty: "Difficult",
      passageHtml: passage, question: `Which ${label} has the lowest adjusted value per original ${rawName}?`, ...choiceSet(rand, minEfficiency.name, pool),
      solution: `Adjusted value per original ${rawName} = adjusted value/${rawName}. ${minEfficiency.name} is lowest at approximately ${money(efficiency(minEfficiency))}.`
    })
  ];
}

function makeDilrSet(seed, setIndex = 0) {
  const variants = [makeDilrRevenueSet, makeDilrTransitSet, makeDilrProjectSet, makeDilrBatchSet, makeDilrScholarshipSet];
  const familyIndex = ((setIndex % (variants.length + dilrGenericSchemas.length)) + variants.length + dilrGenericSchemas.length) % (variants.length + dilrGenericSchemas.length);
  const questions = familyIndex < variants.length
    ? variants[familyIndex](seed, setIndex)
    : makeDilrGenericSet(seed, setIndex, dilrGenericSchemas[familyIndex - variants.length]);
  return questions
    .map((q, i) => ({ ...q, bankSlot: `DILR-${String(setIndex + 1).padStart(4, "0")}-Q${i + 1}` }));
}

function makeDilrRevenueSet(seed, setIndex) {
  const rand = rng(seed ^ 0x53a9b71 ^ setIndex);
  const products = shuffle(rand, ["Atlas", "Beacon", "Crest", "Delta", "Ember", "Fusion"]).slice(0, 5);
  const rows = products.map((name, i) => {
    const apr = 72 + i * 9 + Math.floor(rand() * 22);
    const may = apr + pick(rand, [-8, -3, 6, 11, 17, 23]);
    const jun = may + pick(rand, [-6, 4, 9, 15, 21]);
    return {
      name,
      apr,
      may,
      jun,
      price: pick(rand, [240, 280, 320, 360, 420, 480]) + i * 10,
      discount: pick(rand, [5, 8, 10, 12, 15])
    };
  });
  const netPrice = (r) => r.price * (100 - r.discount) / 100;
  const revenue = (r, month) => r[month] * netPrice(r);
  const headers = ["Module", "April units", "May units", "June units", "List price", "Discount"];
  const table = tableHtml(headers, rows.map((r) => [r.name, r.apr, r.may, r.jun, money(r.price), `${r.discount}%`]));
  const passage = `<p>A CAT prep publisher sold five practice modules in April, May and June. The list price and discount stayed unchanged for each module throughout the three months. Net revenue for a module in a month is calculated after discount.</p>${table}`;
  const juneMax = maxBy(rows, (r) => revenue(r, "jun"));
  const mayTotal = rows.reduce((s, r) => s + revenue(r, "may"), 0);
  const growthMax = maxBy(rows, (r) => (r.jun - r.apr) * 100 / r.apr);
  const cost = pick(rand, [90, 100, 110, 120]);
  const contributionMax = maxBy(rows, (r) => (netPrice(r) - cost) * r.jun);
  const mayOpts = optionize(rand, money(mayTotal), [money(mayTotal + 2400), money(mayTotal - 1800), money(mayTotal + 4200)]);
  const productPool = rows.map((r) => r.name);
  return [
    makeQuestion({
      id: `D-${seed}-${setIndex}-1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Revenue Table", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "Which module had the highest net revenue in June?", ...choiceSet(rand, juneMax.name, productPool),
      solution: `Net price = list price after discount. June net revenue is highest for ${juneMax.name}: ${juneMax.jun} × ${money(netPrice(juneMax))} = ${money(revenue(juneMax, "jun"))}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Revenue Table", difficulty: "Difficult",
      passageHtml: passage, question: "What was the total net revenue from all five modules in May?", ...mayOpts,
      solution: `For each row, May net revenue = May units × list price × (1 - discount/100). Adding all five May revenues gives ${money(mayTotal)}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Revenue Table", difficulty: "Difficult",
      passageHtml: passage, question: "Which module had the highest percentage increase in units from April to June?", ...choiceSet(rand, growthMax.name, productPool),
      solution: `Percentage increase = \\(\\frac{\\text{June units}-\\text{April units}}{\\text{April units}}\\times100\\). ${growthMax.name} is highest at ${pct((growthMax.jun - growthMax.apr) * 100 / growthMax.apr)}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Revenue Table", difficulty: "Difficult",
      passageHtml: passage, question: `If fulfilment cost is ${money(cost)} per unit in June, which module gives the highest June contribution?`, ...choiceSet(rand, contributionMax.name, productPool),
      solution: `Contribution = (net price - fulfilment cost) × June units. ${contributionMax.name} gives the maximum contribution: (${money(netPrice(contributionMax))} - ${money(cost)}) × ${contributionMax.jun} = ${money((netPrice(contributionMax) - cost) * contributionMax.jun)}.`
    })
  ];
}

function makeDilrTransitSet(seed, setIndex) {
  const rand = rng(seed ^ 0x92f315a ^ setIndex);
  const routes = ["R1", "R2", "R3", "R4", "R5"];
  const rows = routes.map((route, i) => ({
    route,
    distance: pick(rand, [84, 96, 108, 120, 132, 144]) + i * 3,
    speed: pick(rand, [42, 45, 48, 54, 60]),
    stops: pick(rand, [18, 24, 30, 36, 42]),
    seats: pick(rand, [36, 40, 44, 48]),
    occupancy: pick(rand, [65, 70, 75, 80, 85, 90]),
    fare: pick(rand, [180, 210, 240, 270, 300])
  }));
  const passengers = (r) => Math.round(r.seats * r.occupancy / 100);
  const travel = (r) => r.distance * 60 / r.speed + r.stops;
  const revenue = (r) => passengers(r) * r.fare;
  const headers = ["Route", "Distance", "Avg speed", "Stop time", "Seats", "Occupancy", "Fare"];
  const table = tableHtml(headers, rows.map((r) => [r.route, `${r.distance} km`, `${r.speed} km/h`, `${r.stops} min`, r.seats, `${r.occupancy}%`, money(r.fare)]));
  const passage = `<p>Five buses leave a coaching hub at 7:00 a.m. on different routes. Travel time equals running time plus total stop time. Passenger count is rounded to the nearest whole number using the given occupancy.</p>${table}`;
  const routePool = rows.map((r) => r.route);
  const slowest = maxBy(rows, travel);
  const bestRevenue = maxBy(rows, revenue);
  const leastPerKm = minBy(rows, (r) => revenue(r) / r.distance);
  const spread = Math.round(travel(slowest) - travel(minBy(rows, travel)));
  const spreadOpts = optionize(rand, `${spread} min`, [`${spread + 8} min`, `${Math.max(1, spread - 7)} min`, `${spread + 14} min`]);
  return [
    makeQuestion({
      id: `D-${seed}-${setIndex}-1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Transit Operations", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "Which route has the highest total travel time?", ...choiceSet(rand, slowest.route, routePool),
      solution: `Total travel time = distance/speed × 60 + stop time. ${slowest.route} is highest at ${Math.round(travel(slowest))} minutes.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Transit Operations", difficulty: "Difficult",
      passageHtml: passage, question: "Which route earns the highest fare revenue?", ...choiceSet(rand, bestRevenue.route, routePool),
      solution: `Fare revenue = rounded passengers × fare. ${bestRevenue.route}: ${passengers(bestRevenue)} × ${money(bestRevenue.fare)} = ${money(revenue(bestRevenue))}, the highest.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Transit Operations", difficulty: "Difficult",
      passageHtml: passage, question: "Which route has the lowest revenue per kilometre?", ...choiceSet(rand, leastPerKm.route, routePool),
      solution: `Revenue per kilometre = fare revenue/distance. ${leastPerKm.route} is lowest at approximately ${money(revenue(leastPerKm) / leastPerKm.distance)} per km.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Transit Operations", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "What is the difference between the highest and lowest total travel time?", ...spreadOpts,
      solution: `Highest travel time = ${Math.round(travel(slowest))} min and lowest travel time = ${Math.round(travel(minBy(rows, travel)))} min. Difference = ${spread} min.`
    })
  ];
}

function makeDilrProjectSet(seed, setIndex) {
  const rand = rng(seed ^ 0x81c2d3a ^ setIndex);
  const teams = shuffle(rand, ["North", "South", "East", "West", "Central", "Metro"]).slice(0, 5);
  const rows = teams.map((team, i) => {
    const cases = 420 + i * 35 + Math.floor(rand() * 70);
    const completion = pick(rand, [62, 66, 70, 74, 78, 82, 86]);
    const analysts = pick(rand, [4, 5, 6, 7]);
    const hours = pick(rand, [28, 30, 32, 34, 36]);
    const rework = pick(rand, [4, 5, 6, 7, 8, 9]);
    return { team, cases, completion, analysts, hours, rework };
  });
  const completed = (r) => r.cases * r.completion / 100;
  const pending = (r) => r.cases - completed(r);
  const productivity = (r) => completed(r) / (r.analysts * r.hours);
  const headers = ["Team", "Cases assigned", "Completed", "Analysts", "Hours/analyst", "Rework rate"];
  const table = tableHtml(headers, rows.map((r) => [r.team, r.cases, `${r.completion}%`, r.analysts, r.hours, `${r.rework}%`]));
  const passage = `<p>Five review teams handled CAT application verification cases during a week. Completed percentage is applied to cases assigned. Rework rate is applied only on completed cases.</p>${table}`;
  const teamPool = rows.map((r) => r.team);
  const bestProductivity = maxBy(rows, productivity);
  const totalPending = Math.round(rows.reduce((s, r) => s + pending(r), 0));
  const reworkMax = maxBy(rows, (r) => completed(r) * r.rework / 100);
  const rate = pick(rand, [6, 7, 8]);
  const leastExtra = minBy(rows, (r) => pending(r) / rate);
  const pendingOpts = optionize(rand, `${totalPending} cases`, [`${totalPending + 18} cases`, `${Math.max(1, totalPending - 21)} cases`, `${totalPending + 37} cases`]);
  return [
    makeQuestion({
      id: `D-${seed}-${setIndex}-1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Project Productivity", difficulty: "Difficult",
      passageHtml: passage, question: "Which team has the highest completed cases per analyst-hour?", ...choiceSet(rand, bestProductivity.team, teamPool),
      solution: `Productivity = completed cases/(analysts × hours). ${bestProductivity.team} is highest at ${productivity(bestProductivity).toFixed(2)} cases per analyst-hour.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Project Productivity", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "How many cases remained pending across all teams at the end of the week?", ...pendingOpts,
      solution: `Pending cases = assigned cases × (1 - completion%). Adding pending cases across all five teams gives approximately ${totalPending} cases.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Project Productivity", difficulty: "Difficult",
      passageHtml: passage, question: "Which team generated the highest number of rework cases?", ...choiceSet(rand, reworkMax.team, teamPool),
      solution: `Rework cases = completed cases × rework rate. ${reworkMax.team} is highest at approximately ${Math.round(completed(reworkMax) * reworkMax.rework / 100)} cases.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Project Productivity", difficulty: "Difficult",
      passageHtml: passage, question: `If one extra analyst-hour clears ${rate} pending cases, which team needs the fewest extra analyst-hours to clear its pending cases?`, ...choiceSet(rand, leastExtra.team, teamPool),
      solution: `Extra analyst-hours needed = pending cases/${rate}. ${leastExtra.team} has the lowest pending load on this basis, needing about ${(pending(leastExtra) / rate).toFixed(1)} analyst-hours.`
    })
  ];
}

function makeDilrBatchSet(seed, setIndex) {
  const rand = rng(seed ^ 0x1209ab7 ^ setIndex);
  const batches = ["A", "B", "C", "D", "E"];
  const rows = batches.map((batch, i) => ({
    batch,
    enrolled: 80 + i * 11 + Math.floor(rand() * 18),
    attendance: pick(rand, [68, 72, 76, 80, 84, 88]),
    mockAttempt: pick(rand, [55, 60, 65, 70, 75]),
    average: pick(rand, [38, 42, 46, 50, 54, 58]),
    fee: pick(rand, [1800, 2100, 2400, 2700])
  }));
  const present = (r) => Math.round(r.enrolled * r.attendance / 100);
  const mockTakers = (r) => Math.round(present(r) * r.mockAttempt / 100);
  const scorePoints = (r) => mockTakers(r) * r.average;
  const headers = ["Batch", "Enrolled", "Attendance", "Mock attempt", "Avg score", "Monthly fee"];
  const table = tableHtml(headers, rows.map((r) => [r.batch, r.enrolled, `${r.attendance}%`, `${r.mockAttempt}% of present`, r.average, money(r.fee)]));
  const passage = `<p>A coaching centre reviewed five CAT batches. Only students present in the week could attempt the mock, and the mock attempt percentage is applied to the number present.</p>${table}`;
  const batchPool = rows.map((r) => `Batch ${r.batch}`);
  const maxTakers = maxBy(rows, mockTakers);
  const bestScoreLoad = maxBy(rows, scorePoints);
  const feeLeader = maxBy(rows, (r) => present(r) * r.fee);
  const totalTakers = rows.reduce((s, r) => s + mockTakers(r), 0);
  const takerOpts = optionize(rand, `${totalTakers} students`, [`${totalTakers + 7} students`, `${Math.max(1, totalTakers - 6)} students`, `${totalTakers + 13} students`]);
  return [
    makeQuestion({
      id: `D-${seed}-${setIndex}-1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Batch Analytics", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "Which batch had the highest number of mock takers?", ...choiceSet(rand, `Batch ${maxTakers.batch}`, batchPool),
      solution: `Mock takers = enrolled × attendance% × mock attempt%. Batch ${maxTakers.batch} has about ${mockTakers(maxTakers)} mock takers, the highest.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Batch Analytics", difficulty: "Difficult",
      passageHtml: passage, question: "What is the total number of mock takers across the five batches?", ...takerOpts,
      solution: `Calculate mock takers for each batch after attendance, then add them. Total mock takers = ${totalTakers}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Batch Analytics", difficulty: "Difficult",
      passageHtml: passage, question: "Which batch contributed the highest total score points in the mock?", ...choiceSet(rand, `Batch ${bestScoreLoad.batch}`, batchPool),
      solution: `Total score points = mock takers × average score. Batch ${bestScoreLoad.batch} is highest with approximately ${Math.round(scorePoints(bestScoreLoad))} score points.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Batch Analytics", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "Which batch generated the highest fee from students present that week?", ...choiceSet(rand, `Batch ${feeLeader.batch}`, batchPool),
      solution: `Weekly present-student fee proxy = present students × monthly fee. Batch ${feeLeader.batch} is highest: ${present(feeLeader)} × ${money(feeLeader.fee)} = ${money(present(feeLeader) * feeLeader.fee)}.`
    })
  ];
}

function makeDilrScholarshipSet(seed, setIndex) {
  const rand = rng(seed ^ 0x445e021 ^ setIndex);
  const centres = shuffle(rand, ["Jaipur", "Indore", "Surat", "Nagpur", "Kochi", "Bhopal"]).slice(0, 5);
  const rows = centres.map((centre, i) => ({
    centre,
    applicants: 140 + i * 17 + Math.floor(rand() * 28),
    quantClear: pick(rand, [48, 52, 56, 60, 64, 68]),
    varcClear: pick(rand, [45, 50, 55, 60, 65]),
    interviewClear: pick(rand, [35, 40, 45, 50, 55]),
    scholarship: pick(rand, [12000, 15000, 18000, 21000])
  }));
  const quant = (r) => Math.round(r.applicants * r.quantClear / 100);
  const varc = (r) => Math.round(quant(r) * r.varcClear / 100);
  const final = (r) => Math.round(varc(r) * r.interviewClear / 100);
  const headers = ["Centre", "Applicants", "Quant clear", "VARC clear", "Interview clear", "Scholarship/student"];
  const table = tableHtml(headers, rows.map((r) => [r.centre, r.applicants, `${r.quantClear}%`, `${r.varcClear}% of Quant clears`, `${r.interviewClear}% of VARC clears`, money(r.scholarship)]));
  const passage = `<p>Five centres ran a three-stage scholarship process. Each percentage is applied sequentially to the candidates who reached that stage. Final selected students receive the listed scholarship amount.</p>${table}`;
  const centrePool = rows.map((r) => r.centre);
  const selectedMax = maxBy(rows, final);
  const payoutMax = maxBy(rows, (r) => final(r) * r.scholarship);
  const conversionMax = maxBy(rows, (r) => final(r) * 100 / r.applicants);
  const totalFinal = rows.reduce((s, r) => s + final(r), 0);
  const finalOpts = optionize(rand, `${totalFinal} students`, [`${totalFinal + 5} students`, `${Math.max(1, totalFinal - 4)} students`, `${totalFinal + 9} students`]);
  return [
    makeQuestion({
      id: `D-${seed}-${setIndex}-1`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Selection Funnel", difficulty: "Moderate-Difficult",
      passageHtml: passage, question: "Which centre had the highest number of final selected students?", ...choiceSet(rand, selectedMax.centre, centrePool),
      solution: `Final selected = applicants × Quant clear% × VARC clear% × interview clear%. ${selectedMax.centre} is highest with about ${final(selectedMax)} students.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-2`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Selection Funnel", difficulty: "Difficult",
      passageHtml: passage, question: "What is the total number of final selected students across all centres?", ...finalOpts,
      solution: `Apply the three stage percentages sequentially for each centre and add the rounded final selections. Total = ${totalFinal} students.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-3`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Selection Funnel", difficulty: "Difficult",
      passageHtml: passage, question: "Which centre has the highest final conversion rate from applicants?", ...choiceSet(rand, conversionMax.centre, centrePool),
      solution: `Final conversion = final selected/applicants. ${conversionMax.centre} is highest at approximately ${pct(final(conversionMax) * 100 / conversionMax.applicants)}.`
    }),
    makeQuestion({
      id: `D-${seed}-${setIndex}-4`, section: "DILR", setTitle: "Data Interpretation and Logical Reasoning", topic: "Selection Funnel", difficulty: "Difficult",
      passageHtml: passage, question: "Which centre has the highest total scholarship payout?", ...choiceSet(rand, payoutMax.centre, centrePool),
      solution: `Total payout = final selected × scholarship per student. ${payoutMax.centre}: ${final(payoutMax)} × ${money(payoutMax.scholarship)} = ${money(final(payoutMax) * payoutMax.scholarship)}.`
    })
  ];
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

function isCurrentQuestionBank(session) {
  return session?.deck?.questionBankVersion === QUESTION_BANK_VERSION;
}

function refreshOutdatedSessions(dateKey = todayKey()) {
  const sessions = readJson(STORE.sessions, {});
  let changed = false;
  for (const block of DAILY_BLOCKS) {
    const key = sessionKey(dateKey, block.id);
    const session = sessions[key];
    if (session && !isCurrentQuestionBank(session)) {
      sessions[key] = {
        deck: buildBlockDeck(dateKey, block.id),
        responses: {},
        report: null,
        refreshedFromVersion: session.deck?.questionBankVersion || "legacy"
      };
      changed = true;
    }
  }
  if (changed) {
    writeJson(STORE.sessions, sessions);
    const active = readJson(STORE.active, {});
    if (active.dateKey === dateKey) localStorage.removeItem(STORE.active);
  }
  return sessions;
}

function questionsForBlock(block, seed, offset) {
  if (block.kind === "varc") {
    const start = offset * DAILY_REQUIREMENTS.varcPassages;
    return Array.from({ length: block.count }, (_, i) => makeVarcSet(seed + i * 9973, start + i)).flat();
  }
  if (block.kind === "dilr") {
    const setOffset = block.id === "evening-dilr" ? 3 : 0;
    const start = offset * DAILY_REQUIREMENTS.dilrSets + setOffset;
    return Array.from({ length: block.count }, (_, i) => makeDilrSet(seed + i * 7919, start + i)).flat();
  }
  const start = offset * DAILY_REQUIREMENTS.quantQuestions;
  return Array.from({ length: block.count }, (_, i) => {
    const q = makeQuant(seed + 31, start + i);
    q.bankSlot = `QUANT-${String(start + i + 1).padStart(4, "0")}`;
    return q;
  });
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
    questionBankVersion: QUESTION_BANK_VERSION,
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
  if (!sessions[key] || !isCurrentQuestionBank(sessions[key])) {
    const fresh = buildBlockDeck(dateKey, blockId);
    sessions[key] = { deck: fresh, responses: {}, report: null };
    writeJson(STORE.sessions, sessions);
  }
  return sessions[key];
}

function saveCurrentSession() {
  const sessions = readJson(STORE.sessions, {});
  const key = deck.sessionKey || sessionKey(deck.dateKey, deck.blockId || DAILY_BLOCKS[0].id);
  deck.questionBankVersion = QUESTION_BANK_VERSION;
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
      <span class="badge">${optionLabel(i, q.options.length)}</span><span>${normalizeMath(o)}</span>
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
    bankSlot: q.bankSlot,
    section: q.section,
    setTitle: q.setTitle,
    topic: q.topic,
    difficulty: q.difficulty,
    passageHtml: q.passageHtml,
    visualHtml: q.visualHtml,
    question: q.question,
    options: q.options.map((option, index) => ({
      label: optionLabel(index, q.options.length),
      text: option,
      selected: picked === index,
      correct: q.answer === index
    })),
    userAnswer: unattempted ? "Unattempted" : `${optionLabel(picked, q.options.length)}. ${q.options[picked]}`,
    correctAnswer: `${optionLabel(q.answer, q.options.length)}. ${q.options[q.answer]}`,
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
  if (q.section === "DILR") return "Multi-step table calculation / comparison";
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
    "Ratio and Proportion": "If quantities are in ratio \\(a:b\\), write them as \\(ax\\) and \\(bx\\), then solve from the total.",
    "Averages": "Combined average \\(=\\frac{n_1a_1+n_2a_2}{n_1+n_2}\\).",
    "Remainders": "Convert the condition into \\(N=dq+r\\), identify \\(N\\), then divide by the required divisor.",
    "Sequences and Series": "AP sum: \\(S_n=\\frac{n}{2}[2a+(n-1)d]\\).",
    "Permutations with Restrictions": "Treat restricted groups as blocks first, then arrange within each block.",
    "Coordinate Geometry": "Distance formula: \\(\\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}\\).",
    "Functions and Graphs": "For \\(- (x-h)^2+k\\), maximum occurs at \\(x=h\\), value \\(k\\).",
    "Pipes and Cisterns": "Net rate \\(=\\) sum of filling rates minus leaking/emptying rates.",
    "Mensuration": "Cylinder volume \\(=\\pi r^2h\\).",
    "Set Theory": "\\(n(A\\cup B)=n(A)+n(B)-n(A\\cap B)\\); neither = total - union.",
    "Revenue Table": "Net revenue \\(=\\text{units}\\times\\text{list price}\\times(1-\\text{discount}/100)\\). Contribution subtracts per-unit cost before multiplying by units.",
    "Transit Operations": "Travel time \\(=\\frac{\\text{distance}}{\\text{speed}}\\times60+\\text{stop time}\\). Revenue \\(=\\text{passengers}\\times\\text{fare}\\).",
    "Project Productivity": "Completed work \\(=\\text{assigned}\\times\\text{completion rate}\\). Productivity \\(=\\frac{\\text{completed work}}{\\text{analysts}\\times\\text{hours}}\\).",
    "Batch Analytics": "Mock takers \\(=\\text{enrolled}\\times\\text{attendance rate}\\times\\text{attempt rate}\\). Score load \\(=\\text{mock takers}\\times\\text{average score}\\).",
    "Selection Funnel": "For sequential stages, multiply the starting count by each stage-clear percentage in order."
  };
  if (q.section === "VARC") return "RC method: identify conclusion, tone, and scope; reject options that are extreme, outside scope, or reverse the author's claim.";
  if (map[q.topic]) return map[q.topic];
  if (q.section === "DILR") return "Create derived columns in order: adjusted count, effective count, adjusted value, and value per original unit. Rank only after computing the required metric.";
  return map[q.topic] || "Use the conditions exactly as written; convert the wording into a small table/equation before choosing an option.";
}

function betterWayFor(q, errorType) {
  if (q.section === "VARC") {
    return "Before looking at options, write a 6-8 word prediction of the answer. Then eliminate options that change the scope or overstate the claim.";
  }
  if (q.section === "DILR") {
    return "Do one derived column at a time, then rank only the derived value asked in the question. Most misses here come from comparing raw table numbers instead of the computed metric.";
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
  if (q.section === "DILR") return "Redo the set by creating the missing derived column first, then compare your computed column with the solution.";
  return `Revise ${q.topic}, then solve 3 similar questions before moving to a new topic.`;
}

function renderReportOptions(item) {
  return `
    <ol class="report-options">
      ${(item.options || []).map((option) => {
        const classes = [
          option.correct ? "correct" : "",
          option.selected ? "selected" : "",
          option.selected && !option.correct ? "wrong" : ""
        ].filter(Boolean).join(" ");
        const tag = option.correct ? "Correct" : option.selected ? "Khushi chose" : "";
        return `<li class="${classes}">
          <span class="option-mark">${option.label}</span>
          <span class="option-copy">${normalizeMath(option.text)}</span>
          ${tag ? `<span class="option-tag">${tag}</span>` : ""}
        </li>`;
      }).join("")}
    </ol>`;
}

function renderReportContext(item) {
  if (!item.passageHtml && !item.visualHtml) {
    return `<div class="report-context compact">No separate passage or set data was required for this question.</div>`;
  }
  return `
    <section class="report-context">
      <div class="report-subhead">${item.section === "VARC" ? "Full passage" : "Set data / working table"}</div>
      ${item.passageHtml ? `<div class="report-passage">${item.passageHtml}</div>` : ""}
      ${item.visualHtml ? `<div class="report-visual">${item.visualHtml}</div>` : ""}
    </section>`;
}

function renderQuestionAnalysisCard(item, index) {
  return `
    <article class="mini-analysis ${item.correct ? "correct" : "wrong"}">
      <div class="report-question-head">
        <div>
          <div class="review-meta">Q${index + 1} • ${item.bankSlot || item.id} • ${item.section} • ${item.topic} • ${item.difficulty}</div>
          <h4>${normalizeMath(item.question)}</h4>
        </div>
        <span class="result-chip ${item.correct ? "correct" : "wrong"}">${item.errorType}</span>
      </div>
      ${renderReportContext(item)}
      <div class="report-subhead">Options</div>
      ${renderReportOptions(item)}
      <div class="answer-grid">
        <p><b>Khushi's answer</b><span class="${item.correct ? "pill-good" : "pill-bad"}">${normalizeMath(item.userAnswer)}</span></p>
        <p><b>Correct answer</b><span class="pill-good">${normalizeMath(item.correctAnswer)}</span></p>
      </div>
      <section class="analysis-detail">
        <p><b>Formula / idea used:</b> ${normalizeMath(item.formula)}</p>
        <p><b>Detailed solution:</b> ${normalizeMath(item.solution)}</p>
        <p><b>Better way to solve:</b> ${normalizeMath(item.betterWay)}</p>
        <p><b>Next step:</b> ${normalizeMath(item.nextStep)}</p>
      </section>
    </article>`;
}

function renderReport(report) {
  const needsRichItems = !report.items || report.items.some((item) => !item.options || !("passageHtml" in item));
  const reportItems = needsRichItems ? deck.questions.map((q) => {
    const picked = responses[q.id];
    return questionAnalysis(q, picked, picked === q.answer);
  }) : report.items;
  $("reportTitle").textContent = `${report.blockTitle || "Analysis"} • ${displayDate(report.dateKey)}`;
  $("scoreSummary").innerHTML = `
    <div><b>${report.correct}/${report.total}</b><span>correct</span></div>
    <div><b>${report.attempted}</b><span>attempted</span></div>
    <div><b>${report.accuracy}%</b><span>accuracy</span></div>
    <div><b>${Object.keys(report.bySection).length}</b><span>sections</span></div>`;
  const sec = Object.entries(report.bySection).map(([name, s]) => `<li><b>${name}</b>: ${s.correct}/${s.total} correct, ${s.attempted} attempted.</li>`).join("");
  const weak = report.weakest.length ? report.weakest.map(([t, n]) => `<li>${t}: ${n} miss${n > 1 ? "es" : ""}. Revise concept, then redo similar questions untimed.</li>`).join("") : "<li>No weak area today. Preserve this pace and review solutions anyway.</li>";
  const detailed = reportItems.map((item, i) => renderQuestionAnalysisCard(item, i)).join("");
  $("improvementBox").innerHTML = `
    <h3>What went wrong</h3><ul>${sec}</ul>
    <h3>What to do next</h3><ul>${weak}</ul>
    <p class="report-recommendation">Recommendation: spend 20 minutes reviewing only wrong and unattempted questions, then write one-line error notes: concept gap, calculation slip, misread condition, or option trap.</p>
    <h3>Question-by-question detailed review</h3>${detailed}`;
  typesetMath([$("improvementBox")]);
}

function renderReview() {
  $("reviewList").innerHTML = deck.questions.map((q, i) => {
    const picked = responses[q.id];
    const ok = picked === q.answer;
    return `<article class="review-item ${ok ? "correct" : "wrong"}">
      <div class="review-meta">${i + 1}. ${q.bankSlot || q.id} • ${q.section} • ${q.topic} • ${q.difficulty}</div>
      <h3>${normalizeMath(q.question)}</h3>
      ${q.passageHtml ? `<div class="solution">${q.passageHtml}</div>` : ""}
      ${q.visualHtml ? `<div class="visual-panel">${q.visualHtml}</div>` : ""}
      <p>Your answer: <span class="${ok ? "pill-good" : "pill-bad"}">${normalizeMath(picked === undefined ? "Unattempted" : optionLabel(picked, q.options.length) + ". " + q.options[picked])}</span></p>
      <p>Correct answer: <span class="pill-good">${normalizeMath(optionLabel(q.answer, q.options.length) + ". " + q.options[q.answer])}</span></p>
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
      `Q${i + 1}. ${item.section} - ${item.topic} - ${item.difficulty}`,
      `Bank slot: ${item.bankSlot || item.id}`,
      item.passageHtml ? `Passage / set data: ${textOnly(item.passageHtml)}` : "",
      `Question: ${item.question}`,
      `Options:`,
      ...(item.options || []).map((option) => {
        const notes = [option.selected ? "Khushi chose" : "", option.correct ? "Correct" : ""].filter(Boolean);
        return `${option.label}. ${option.text}${notes.length ? ` (${notes.join(", ")})` : ""}`;
      }),
      `Khushi's answer: ${item.userAnswer}`,
      `Correct answer: ${item.correctAnswer}`,
      `Error type: ${item.errorType}`,
      `Formula/idea: ${item.formula}`,
      `Better way: ${item.betterWay}`,
      `Solution: ${item.solution}`,
      `Next step: ${item.nextStep}`
    ].filter(Boolean).join(`\n`))
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
  const sessions = refreshOutdatedSessions(date);
  const blockStates = DAILY_BLOCKS.map((block) => {
    const session = sessions[sessionKey(date, block.id)];
    return { block, session, done: Boolean(session?.report), started: Boolean(session && !session.report) };
  });
  const doneToday = blockStates.filter((state) => state.done).length;
  const targets = realBankTargets();
  $("todayLine").textContent = `${displayDate(date)} is ready: Morning VARC, Morning DILR, Evening DILR, and Evening Quant. Completed blocks lock until tomorrow's reset.`;
  $("daysLeft").textContent = Math.max(0, daysBetween(date, CAT_DATE) + 1);
  $("bankCount").textContent = `${targets.totalQuestions.toLocaleString("en-IN")}+`;
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

async function keepFirebaseLoginLocal() {
  if (!window.firebase?.auth) return;
  await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
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
    await keepFirebaseLoginLocal();
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
  user = readJson(STORE.user, null);
  if (user) {
    $("logoutBtn").classList.remove("hidden");
    renderHome();
    show("homeScreen");
  }
  if (cfg.firebase?.apiKey && window.firebase) {
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
      firebaseReady = true;
      keepFirebaseLoginLocal().catch((err) => console.warn("Firebase persistence skipped", err));
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
$("previewBtn").onclick = () => {
  const t = realBankTargets();
  alert(`Daily target till 29 Nov 2026:\n\nMorning VARC: 4 passages\nMorning DILR: 3 sets\nEvening DILR: 2 sets\nEvening Quant: 30 questions\n\nReal no-repeat bank target:\n${t.varcPassages} VARC passages (${t.varcPassages * 4} questions)\n${t.dilrSets} DILR sets (${t.dilrSets * 4} questions)\n${t.quantQuestions} Quant questions\n${t.totalQuestions} total question-level entries\n\nEach block locks after completion and resets the next day in IST.`);
};
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
