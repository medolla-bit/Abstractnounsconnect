import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const sessions = new Map();

function codeClean(code) {
  return String(code || "TODAY").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) || "TODAY";
}

function getSession(code) {
  code = codeClean(code);
  if (!sessions.has(code)) {
    sessions.set(code, {
      code,
      createdAt: new Date().toISOString(),
      active: true,
      mode: "Upper Elementary",
      noun1: "Candle",
      noun2: "Whisper",
      category: "quiet signals",
      prompt: "What hidden connection can you find between these two ideas?",
      responses: [],
      displayMode: "gallery",
      displayNames: true,
      released: { responses: false, poem: false, summary: false },
      classPoem: "",
      summary: ""
    });
  }
  return sessions.get(code);
}

function schoolSafe(text) {
  const blocked = ["fuck","shit","bitch","asshole","dick","pussy","cunt","nigger","faggot","kys","kill yourself","porn","sex"];
  const lower = String(text || "").toLowerCase();
  return !blocked.some(w => lower.includes(w));
}

async function callOpenAI({ system, user, maxTokens = 350, temperature = 0.75 }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it in Render → Environment.");
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature,
      max_tokens: maxTokens
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed.");
  }
  return data.choices?.[0]?.message?.content?.trim() || "";
}

const coachSystem = `
You are a warm, thoughtful writing coach for upper elementary and middle school students.

Students are exploring ideas. There are NO wrong answers. Every idea has value and potential.

Your voice:
- encouraging, natural, and human
- makes students feel their words are worth developing
- validates a specific part of their thinking
- tracks how their thinking grows across rounds
- keeps everything age appropriate, classroom safe, and emotionally appropriate for kids
- does not become too mature, dark, romantic, violent, or heavy
- does not rewrite the student's idea
- does not say "I like your idea, but..."
- does not sound robotic or formulaic

If the response is inappropriate, unsafe, mean, sexual, violent, or disrespectful:
- calmly say it may not fit the classroom writing space
- ask them to reshape it into something symbolic, respectful, or school appropriate
- stay supportive, not scolding

Keep responses short: 2 to 4 sentences.
End with ONE thoughtful nudge or question.
`;

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ai: Boolean(OPENAI_API_KEY) });
});

app.post("/api/session/start", (req, res) => {
  const body = req.body || {};
  const code = codeClean(body.code);
  const session = getSession(code);
  session.mode = body.mode || session.mode;
  session.noun1 = body.noun1 || session.noun1;
  session.noun2 = body.noun2 || session.noun2;
  session.category = body.category || session.category || body.mode || "";
  session.prompt = body.prompt || session.prompt;
  session.active = true;
  session.updatedAt = new Date().toISOString();
  res.json({ session });
});

app.get("/api/session/:code", (req, res) => {
  const session = getSession(req.params.code);
  res.json({ session });
});

app.post("/api/session/:code/submit", async (req, res) => {
  const session = getSession(req.params.code);
  const body = req.body || {};
  const name = String(body.name || "").trim().slice(0, 50);
  const rounds = Array.isArray(body.rounds)
    ? body.rounds.map(x => String(x || "").trim()).filter(Boolean).slice(0, 3)
    : [];

  if (!name || rounds.length < 3)
    return res.status(400).json({ error: "Name and three responses are required." });
  if (!schoolSafe(name) || !rounds.every(schoolSafe))
    return res.status(400).json({ error: "Please keep responses school appropriate." });

  let poem = "";
  let influence = "";
  let thinking = "";
  try {
    poem      = await createStudentPoem(session, rounds);
    influence = await analyzeInfluence(rounds);
    thinking  = await analyzeThinkingLevel(rounds, session);
  } catch (err) {
    poem      = fallbackStudentPoem(session, rounds);
    influence = "AI analysis was not available.";
    thinking  = "Level 2: symbolic connection.";
  }

  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name,
    rounds,
    responseText: rounds.map((r, i) => `Round ${i+1}: ${r}`).join("\n\n"),
    poem,
    influence,
    thinking,
    approved: false
  };
  session.responses.push(entry);
  res.json({ entry, session });
});

app.post("/api/ai/coach", async (req, res) => {
  try {
    const { text, round, noun1, noun2, previousResponses = [] } = req.body || {};
    if (!text || !schoolSafe(text)) {
      return res.json({
        reply: "This idea may not fit our classroom writing space as it is. Can you keep the same energy or feeling, but reshape it in a respectful, symbolic, school-appropriate way?"
      });
    }
    const user = `
Noun pair: ${noun1 || "the two ideas"} and ${noun2 || "another idea"}

Previous responses:
${(previousResponses || []).map((r, i) => `Round ${i+1}: ${r}`).join("\n") || "None yet"}

Current response:
"${text}"

Current round: ${round || 1}

Respond as the writing coach. Make the student feel their words have value. Track growth if previous responses exist. End with one question or nudge.
`;
    const reply = await callOpenAI({ system: coachSystem, user, maxTokens: 180, temperature: 0.82 });
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message || "AI coach failed." });
  }
});

async function createStudentPoem(session, rounds) {
  const system = `
You create short, polished poems from upper elementary or middle school student thinking.
Preserve the student's ideas and voice. Do not make content too mature.
Keep it school appropriate. Make it feel special, but not adult or overwritten.
`;
  const user = `
Create a short poem from this student's three responses.

Noun pair: ${session.noun1} and ${session.noun2}
Theme: ${session.category}
Prompt: ${session.prompt}

Student responses:
${rounds.map((r, i) => `Round ${i+1}: ${r}`).join("\n")}

Requirements:
- Include a title.
- Use the student's language and ideas.
- Keep it 8 to 14 lines.
- Do not mention AI.
`;
  return callOpenAI({ system, user, maxTokens: 420, temperature: 0.78 });
}

function fallbackStudentPoem(session, rounds) {
  return `${session.noun1} & ${session.noun2}\n\n${rounds.map(r => r.replace(/[.!?]+$/, "")).join("\n")}\n\nAt first they looked separate,\nbut thinking found the thread.`;
}

async function analyzeInfluence(rounds) {
  const system = `
You analyze whether student writing seems mostly original or strongly shaped by AI coaching language.
Be careful and fair. Do not accuse. This is for teacher reflection, not punishment.
`;
  const user = `
Analyze these three student responses:
${rounds.map((r, i) => `Round ${i+1}: ${r}`).join("\n")}

Return:
1. One label: Mostly original, Some coach influence, or Heavily coach-shaped
2. One short explanation
`;
  return callOpenAI({ system, user, maxTokens: 140, temperature: 0.3 });
}

async function analyzeThinkingLevel(rounds, session) {
  const system = `
You analyze student thinking levels for a teacher. Use warm, concise, classroom-friendly language.
Levels:
Level 1: literal or surface connection
Level 2: symbolic connection
Level 3: abstract insight or surprising interpretation
`;
  const user = `
Noun pair: ${session.noun1} and ${session.noun2}

Student responses:
${rounds.map((r, i) => `Round ${i+1}: ${r}`).join("\n")}

Return:
- Thinking level
- Evidence from their writing
- One next step
Keep it concise.
`;
  return callOpenAI({ system, user, maxTokens: 180, temperature: 0.35 });
}

app.post("/api/ai/class-poem", async (req, res) => {
  try {
    const session = getSession(req.body.code);
    const selectedIds = req.body.selectedIds || [];
    const chosen = (selectedIds.length
      ? session.responses.filter(r => selectedIds.includes(r.id))
      : session.responses.filter(r => r.approved)
    ).slice(0, 16);

    if (!chosen.length)
      return res.status(400).json({ error: "Approve or select at least one response first." });

    const system = `
You help a teacher synthesize student thinking into a collective classroom poem.
Keep student ideas intact. Use age appropriate language. The poem should feel polished but still student-centered.
`;
    const user = `
Create a class poem from these student ideas.

Noun pair: ${session.noun1} and ${session.noun2}
Theme: ${session.category}
Prompt: ${session.prompt}

Student contributions:
${chosen.map(r => `${r.name}: ${r.responseText}`).join("\n\n")}

Requirements:
- Include a title.
- 12 to 22 lines.
- Preserve student ideas.
- Add parenthetical attribution after some lines, like (from Ava) or (inspired by Student 2).
- Keep classroom appropriate.
`;
    const poem = await callOpenAI({ system, user, maxTokens: 700, temperature: 0.8 });
    session.classPoem = poem;
    res.json({ poem });
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not create class poem." });
  }
});

app.post("/api/ai/summary", async (req, res) => {
  try {
    const session = getSession(req.body.code);
    if (!session.responses.length)
      return res.status(400).json({ error: "No responses yet." });

    const system = `
You summarize class thinking for a teacher and students.
Be specific, encouraging, and age appropriate.
Name the strongest thinking moves, not just the best students.
`;
    const user = `
Summarize the best collective thinking from this session.

Noun pair: ${session.noun1} and ${session.noun2}
Student responses:
${session.responses.map(r => `${r.name}: ${r.responseText}`).join("\n\n")}

Return:
- 3 strongest thinking moves
- 3 notable ideas with attribution
- one next discussion question
`;
    const summary = await callOpenAI({ system, user, maxTokens: 500, temperature: 0.55 });
    session.summary = summary;
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not create summary." });
  }
});

app.post("/api/ai/revise-poem", async (req, res) => {
  try {
    const { code, poem, instruction, style } = req.body || {};
    const session = code ? getSession(code) : null;
    const system = `
You are a teacher's class poem revision partner.
Keep student ideas intact. Keep content age appropriate. Do not make it too mature.
Help revise the collective poem based on the teacher's request.
`;
    const user = `
Original poem:
${poem || session?.classPoem || ""}

Teacher request:
${instruction || style || "make it clearer and more polished"}

Style options might include: simpler, rhyme, lyrical, song, shorter, more student-like, more powerful.

Revise the poem. Keep student ideas and attribution when possible.
`;
    const revised = await callOpenAI({ system, user, maxTokens: 750, temperature: 0.78 });
    if (session) session.classPoem = revised;
    res.json({ revised });
  } catch (err) {
    res.status(500).json({ error: err.message || "Could not revise poem." });
  }
});

app.post("/api/session/:code/approve", (req, res) => {
  const session = getSession(req.params.code);
  const { id, approved } = req.body || {};
  const item = session.responses.find(r => r.id === id);
  if (item) item.approved = Boolean(approved);
  res.json({ session });
});

app.post("/api/session/:code/display", (req, res) => {
  const session = getSession(req.params.code);
  Object.assign(session, req.body || {});
  res.json({ session });
});

app.delete("/api/session/:code/responses", (req, res) => {
  const session = getSession(req.params.code);
  session.responses = [];
  session.classPoem = "";
  session.summary = "";
  res.json({ session });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Class Thinking Lab running at http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) console.log("⚠️  Add OPENAI_API_KEY in Render → Environment Variables.");
});
