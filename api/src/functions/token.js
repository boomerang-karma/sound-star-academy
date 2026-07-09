const { app } = require("@azure/functions");

// Exchanges the secret Speech key (server-side env var) for a short-lived
// token the browser can safely use. The key itself never leaves Azure.
app.http("token", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    if (!key || !region) {
      return {
        status: 500,
        jsonBody: { error: "AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not configured" },
      };
    }

    try {
      const r = await fetch(
        `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
        {
          method: "POST",
          headers: { "Ocp-Apim-Subscription-Key": key, "Content-Length": "0" },
        }
      );
      if (!r.ok) {
        return { status: 502, jsonBody: { error: "Token exchange failed" } };
      }
      const token = await r.text();
      return { jsonBody: { token, region } };
    } catch (e) {
      return { status: 502, jsonBody: { error: "Could not reach Azure Speech" } };
    }
  },
});
