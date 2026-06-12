const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const multer = require("multer");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static("../frontend"));

// ─── POST /api/retete ──────────────────────────────────────────────────────────
app.post("/api/retete", async (req, res) => {
  try {
    const { ingrediente, prompt_override } = req.body;
    if (!ingrediente || !ingrediente.length)
      return res.status(400).json({ error: "Lista ingrediente lipsă." });

    const prompt = prompt_override || `Ești chef culinar român. Utilizatorul are: ${ingrediente.join(", ")}.
Generează 15 rețete REALE care folosesc aceste ingrediente logic (nu combina lapte cu ceapă aiurea).
Corectează greșelile de scriere.
Răspunde DOAR JSON:
{
  "ingrediente_corectate": [{"original":"...","corectat":"...","emoji":"..."}],
  "retete": [{"nume":"...","ingrediente_folosite":["..."],"ingrediente_complete":["..."],"timp":"...","dificultate":"Ușor","calorii":300,"proteine":20,"carbohidrati":30,"grasimi":10,"pasi":["..."]}]
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/retete:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/analizeaza-bon ─────────────────────────────────────────────────
app.post("/api/analizeaza-bon", upload.single("bon"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nicio imagine trimisă." });
    const imageBase64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: `Analizează acest bon de casă. Extrage DOAR alimentele (ignoră detergenți, cosmetice, produse non-alimentare).
Răspunde DOAR cu JSON valid:
{"ingrediente": ["aliment1", "aliment2", ...]}
Scrie ingredientele clar în română, fără abrevieri.` }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/analizeaza-bon:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/citeste-expirare ───────────────────────────────────────────────
app.post("/api/citeste-expirare", upload.single("produs"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Nicio imagine trimisă." });
    const imageBase64 = req.file.buffer.toString("base64");
    const mediaType = req.file.mimetype || "image/jpeg";

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: `Extrage numele produsului și data de expirare.
Răspunde DOAR cu JSON: {"nume":"...","data":"YYYY-MM-DD","categorie":"dairy|meat|veggie|fruit|bakery|other"}
Dacă nu găsești data pune azi + 7 zile.` }
        ]
      }]
    });

    const text = message.content.map((b) => b.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (err) {
    console.error("❌ /api/citeste-expirare:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date() }));


// ── Keep-alive: ping la fiecare 14 minute ca sa nu adoarma pe Render ──────────
const https = require('https');
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || '';

if (RENDER_URL) {
  setInterval(() => {
    https.get(RENDER_URL + '/api/health', (res) => {
      console.log('Keep-alive ping:', res.statusCode);
    }).on('error', (e) => {
      console.log('Keep-alive error:', e.message);
    });
  }, 14 * 60 * 1000); // 14 minute
  console.log('Keep-alive activ pentru:', RENDER_URL);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Melio API pornit pe http://localhost:${PORT}`);
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ configurată' : '✗ LIPSĂ — pune în .env'}`);
});
