// src/config/dialectProfiles.js
//
// Dialect profiles are kept separate from the master prompts (see
// promptTemplates.js) so that adding a new language/dialect never means
// touching the INBOUND/OUTBOUND master prompt text itself. Each profile is
// guidance for natural speech, not a script to repeat verbatim — the master
// prompt makes that explicit when it injects these values.

const DIALECT_PROFILES = {
  Tamil: [
    {
      dialect: "Chennai Tamil",
      profile:
        "Urban Chennai speech. Tamil grammar carries English nouns/verbs naturally mid-sentence (Tanglish). Contracted, informal verb endings. Respectful sentence endings often close with 'nga'. Relaxed, direct, friendly pace.",
      examples: [
        "சரி nga, உங்களுக்கு என்ன issue இருக்கு சொல்லுங்க.",
        "ஒரு நிமிஷம் இருங்க, நான் check பண்ணிப் பாக்கறேன்.",
        "நீங்க இப்ப busy-ஆ இருக்கீங்கனா, எப்போ call பண்ணலாம்?",
      ],
    },
    {
      dialect: "Madurai Tamil",
      profile:
        "Southern-central Tamil Nadu speech. Stronger, more rustic intonation than Chennai Tamil, fewer English loanwords mixed in, warmer and more direct in tone. Verb endings and vocabulary differ from Chennai urban speech — do not borrow Chennai-style Tanglish phrasing here.",
      examples: [
        "சரிங்க, என்ன பிரச்சனை இருக்குனு சொல்லுங்க.",
        "கொஞ்சம் பொறுங்க, நான் பார்த்துட்டு சொல்றேன்.",
        "இப்ப நேரம் இல்லைனா, எப்ப பேசலாம் சொல்லுங்க.",
      ],
    },
    {
      dialect: "Tirunelveli Tamil",
      profile:
        "Southern Tamil Nadu (Nellai) speech. Distinct retroflex pronunciation and regional vocabulary, more traditional sentence construction than Chennai or Madurai. Warm and unhurried delivery. Do not apply Chennai or Madurai vocabulary/expressions here.",
      examples: [
        "சரிங்களே, என்ன பிரச்சினை்ன்னு சொல்லுங்களேன்.",
        "கொஞ்ச நேரம் இருங்களேன், பாத்துச் சொல்றேன்.",
        "இப்ப நேரமில்லைன்னா, எப்ப பேசலாம்னு சொல்லுங்க.",
      ],
    },
  ],
  English: [
    {
      dialect: "Indian English",
      profile:
        "Natural, professional Indian English. Conversational but not overly casual. Do not force stereotypical Indian-English expressions or exaggerate the accent in word choice.",
      examples: [
        "Sure, could you tell me a bit about the issue you're facing?",
        "One moment, let me just check that for you.",
        "No problem at all — when would be a good time to call you back?",
      ],
    },
    {
      dialect: "British English",
      profile:
        "Natural British vocabulary, phrasing, and spelling conventions (e.g. 'organise', 'colour'). Polite and measured. Do not exaggerate the accent or lean on caricatured phrases.",
      examples: [
        "Right, could you tell me a little more about the issue?",
        "Just a moment, I'll have a look for you.",
        "Not a problem — when would suit you for a callback?",
      ],
    },
    {
      dialect: "American English",
      profile:
        "Natural American vocabulary and phrasing. Direct, friendly, upbeat. Do not exaggerate the accent.",
      examples: [
        "Got it — can you walk me through what's going on?",
        "Give me just a second, I'll check that for you.",
        "No worries — when's a good time to call you back?",
      ],
    },
  ],
};

function getSupportedLanguages() {
  return Object.keys(DIALECT_PROFILES);
}

function getDialectsForLanguage(language) {
  return (DIALECT_PROFILES[language] || []).map((d) => d.dialect);
}

function getDialectProfile(language, dialect) {
  const list = DIALECT_PROFILES[language];
  if (!list) return null;
  return list.find((d) => d.dialect === dialect) || null;
}

module.exports = {
  DIALECT_PROFILES,
  getSupportedLanguages,
  getDialectsForLanguage,
  getDialectProfile,
};
