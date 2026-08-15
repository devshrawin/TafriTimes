You are writing the content for a **6-slide Instagram carousel** that will
be pinned as the first post on **Tafri Times**, an India-specific satire
news account (like The Onion / The Fauxy). This carousel's job is pure
onboarding: a new visitor who lands on the profile should understand what
this account is, why it exists, and how it works — in 6 quick, funny,
scannable slides. This is NOT a satire news piece itself — it's the
"About us" for the brand, so it can speak in first person as the brand.

## Brand facts to work from

- Name: **Tafri Times**. Tagline: **"Because real news is boring."**
- It's satire — fake news headlines about India (politics, bureaucracy,
  cricket, Bollywood, urban life) written to be obviously absurd, formatted
  like real news.
- Every post carries a permanent **"SATIRE"** mark and ends captions with
  "(satire)" — because it's been mistaken for real news before (the risk
  every satire outlet runs), so it leans hard into being unmistakable.
- Content is AI-generated, then automatically reviewed for safety before
  anything posts (never real named individuals, nothing communal/caste-
  targeted, nothing making light of real tragedy).
- Tone is affectionate ribbing, not cynicism — poking fun at bureaucracy
  and absurd situations like teasing a sibling, not "everything is broken."
- Visual identity: near-black background (#0b0b0c), cream/off-white bold
  text, a red/orange accent color, bold condensed sans-serif headline
  typography, a torn-newspaper-clipping texture motif in the background.

## Slide arc (exactly 6 slides)

1. **Cover** — the Tafri Times name/tagline as a title card, inviting and
   punchy, sets the tone immediately.
2. **What this is** — plainly explain: fake news, made for laughs, India-
   focused satire in The Onion/Fauxy tradition.
3. **Why it exists** — the "because real news is boring" pitch — playful
   case for why absurd fake news is more fun than doom-scrolling real news.
4. **How it's made** — AI writes it, a safety check reviews it before it
   ever posts, always clearly marked SATIRE — reassuring, not defensive.
5. **What to expect** — the recurring beats (politics, cricket, Bollywood,
   bureaucracy, everyday chaos), tone is warm not mean, new posts often.
6. **Follow / disclaimer** — closing call-to-action to follow, paired with
   the plain-language "this is 100% fictional, not real news" disclaimer.

## Output format

For each slide, write a **complete, ready-to-paste image-generation
prompt** for ChatGPT's image tool — self-contained, describing the full
visual AND specifying the exact on-image text verbatim (ChatGPT's image
model renders text directly, so give it the literal words to render, not
a vague description of the message). Keep consistent visual style
instructions across all 6 so they read as one cohesive carousel.

Return ONLY a JSON object, no markdown fences, no other text:

```
{
  "slides": [
    { "slideNumber": 1, "title": "short internal label for this slide", "imagePrompt": "string — the full ChatGPT prompt" }
  ]
}
```
