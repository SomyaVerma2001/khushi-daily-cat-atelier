const START_DATE = "2026-06-30";
const CAT_DATE = "2026-11-29";
const QUESTION_BANK_VERSION = "2026-06-30-cat-level-refresh-v2";
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
  }
];

function makeVarcSet(seed) {
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
    id: `V-${seed}-1`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Difficult",
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
    id: `V-${seed}-2`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Moderate-Difficult",
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
    id: `V-${seed}-3`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Difficult",
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
    id: `V-${seed}-4`, section: "VARC", setTitle: "Reading Comprehension", topic: t.topic, difficulty: "Difficult",
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

function makeDilrSet(seed, setIndex = 0) {
  const variants = [makeDilrRevenueSet, makeDilrTransitSet, makeDilrProjectSet, makeDilrBatchSet, makeDilrScholarshipSet];
  return variants[((setIndex % variants.length) + variants.length) % variants.length](seed, setIndex);
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
    return Array.from({ length: block.count }, (_, i) => makeVarcSet(seed + i * 9973)).flat();
  }
  if (block.kind === "dilr") {
    const setOffset = block.id === "evening-dilr" ? 3 : 0;
    return Array.from({ length: block.count }, (_, i) => makeDilrSet(seed + i * 7919, i + setOffset)).flat();
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
    "Revenue Table": "Net revenue \\(=\\text{units}\\times\\text{list price}\\times(1-\\text{discount}/100)\\). Contribution subtracts per-unit cost before multiplying by units.",
    "Transit Operations": "Travel time \\(=\\frac{\\text{distance}}{\\text{speed}}\\times60+\\text{stop time}\\). Revenue \\(=\\text{passengers}\\times\\text{fare}\\).",
    "Project Productivity": "Completed work \\(=\\text{assigned}\\times\\text{completion rate}\\). Productivity \\(=\\frac{\\text{completed work}}{\\text{analysts}\\times\\text{hours}}\\).",
    "Batch Analytics": "Mock takers \\(=\\text{enrolled}\\times\\text{attendance rate}\\times\\text{attempt rate}\\). Score load \\(=\\text{mock takers}\\times\\text{average score}\\).",
    "Selection Funnel": "For sequential stages, multiply the starting count by each stage-clear percentage in order."
  };
  if (q.section === "VARC") return "RC method: identify conclusion, tone, and scope; reject options that are extreme, outside scope, or reverse the author's claim.";
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
          <div class="review-meta">Q${index + 1} • ${item.section} • ${item.topic} • ${item.difficulty}</div>
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
      <div class="review-meta">${i + 1}. ${q.section} • ${q.topic} • ${q.difficulty}</div>
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
