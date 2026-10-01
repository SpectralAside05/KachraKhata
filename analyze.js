const PROMPT = `You are auditing street litter for India's Extended Producer Responsibility (EPR) tracking. Look at the attached photo and list each distinct, identifiable packaging item of litter (max 8). Return ONLY JSON: {"items":[{"brand":"brand name as printed, or Unidentified","item":"short description e.g. chips wrapper","material":"one of PET, HDPE, multilayer sachet, PP, glass, aluminium, paper/cardboard, other plastic, organic, other","recyclable":true or false (realistically recyclable in Indian municipal systems),"confidence":number 0-1 for the brand+material read}]}. Never guess a brand you cannot see; use Unidentified with low confidence. If no litter is visible return {"items":[]}.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Server API key not configured" });

  const { image } = req.body || {};
  if (typeof image !== "string" || image.length < 100 || image.length > 3500000) {
    return res.status(400).json({ error: "Invalid or too large image" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || "Model request failed" });

    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ items: Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : [] });
  } catch (e) {
    return res.status(500).json({ error: "Could not analyse this photo" });
  }
};
