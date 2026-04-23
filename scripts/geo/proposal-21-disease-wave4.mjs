process.env.GEO_DISEASE_WAVE_KEY = "wave4";
process.env.GEO_DISEASE_WAVE_FILE = "disease-wave4-packets.json";
process.env.GEO_DISEASE_WAVE_LABEL = "Wave 4 cross-system expansion";
process.env.GEO_PROPOSAL_NAME = "Disease Atlas - Wave 4 cross-system expansion";
process.env.GEO_SKIP_TAB_RESET = "1";

await import("./proposal-14-disease-wave3.mjs");
