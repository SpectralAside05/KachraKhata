const PROMPT = `You are auditing street litter for India's Extended Producer Responsibility (EPR) tracking. Look at the attached photo and list each distinct, identifiable packaging item of litter (max 8). Return ONLY JSON: {"items":[{"brand":"brand name as printed, or Unidentified","item":"short description e.g. chips wrapper","material":"one of PET, HDPE, multilayer sachet, PP, glass, aluminium, paper/cardboard, other plastic, organic, other","recyclable":true or false (realistically recyclable in Indian municipal systems),"confidence":number 0-1 for the brand+material read}]}. Never guess a brand you cannot see; use Unidentified with low confidence. If no litter is visible return {"items":[]}.`;

const hits = new Map(); // simple per-IP limit to protect the free quota

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server API key not configured" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 6) return res.status(429).json({ error: "Too many photos at once. Wait a minute and retry." });
  recent.push(now);
  hits.set(ip, recent);

  const { image } = req.body || {};
  if (typeof image !== "string" || image.length < 100 || image.length > 3500000) {
    return res.status(400).json({ error: "Invalid or too large image" });
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    const data = await r.json();
    if (r.status === 429) return res.status(429).json({ error: "Free AI quota is busy right now. Try again in a minute." });
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || "Model request failed" });

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map(p => p.text || "").join("");
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return res.status(200).json({ items: Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [] });
  } catch (e) {
    return res.status(500).json({ error: "Could not analyse this photo" });
  }
};
