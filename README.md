# AI to AI

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

Pick a topic, pick two AI personas, pick a model for each, and watch the two
of them hold a real back-and-forth conversation. Agent A opens, Agent B
answers, and they keep going for as many turns as you set. You can stop it at
any point, or throw in a twist mid-conversation ("now both of you argue the
opposite side") and watch the next speaker deal with it.

Built for Pollinations quest #19178: "An app or game where AIs talk to each
other."

## What you get

- **Two agents, your casting.** 8 personas (Skeptic, Optimist, Engineer,
  Scientist, Poet, Contrarian, Comedian, Historian), each with an editable
  character brief. Each agent gets its own model, from different labs by
  default: GPT-5.4 Nano (OpenAI) against DeepSeek V4 Flash (DeepSeek).
  The picker also has GLM 5.3 Flash, Kimi K2.6, Mistral Large 3, Llama 3.3
  70B, Grok 4.3, GPT-5.5 and GPT-OSS 20B, plus a custom model id field for
  anything else on the Pollinations model list.
- **A real conversation, not two monologues.** Every turn is a fresh call
  with the full history mapped in: the speaker's own past lines as its
  replies, the other agent's lines as incoming messages, twists as host
  instructions. Replies are capped short so it reads like a chat, not an
  essay exchange.
- **Numbers on every turn.** Per-turn latency, token count and estimated
  Pollen cost on each bubble, plus a running tally bar: turns, tokens, total
  estimated cost, total latency, and the token split between Agent A and B.
- **Stop and twist controls.** Stop ends the run with a partial transcript
  intact. A twist can be injected while it runs, or queued before you start.
- **Shareable transcript.** One click downloads a Markdown transcript with
  the topic, both agents and models, every turn with its stats, any twists,
  and the final totals.
- **Demo mode.** No key, no problem: the app runs a clearly labelled
  scripted sample exchange so you can see the format. Demo mode spends
  nothing and never pretends to be live output.

## Bring your own Pollen

Visitors pay with their own Pollen. There is no shared key anywhere in this
code.

1. Get a key at [enter.pollinations.ai/keys](https://enter.pollinations.ai/keys).
2. Paste it into the key field at the top of the page. Format is checked in
   the browser (`sk_` or `pk_` keys), and the **Test key** button checks it
   against `GET https://gen.pollinations.ai/account/balance`.
3. Hit **Save key**. The key is stored only in your browser's
   `localStorage`, and is only ever sent to `gen.pollinations.ai` in the
   `Authorization` header of the conversation calls.

Every live turn is one `POST https://gen.pollinations.ai/v1/chat/completions`
billed to your balance. Cost estimates use the per-token prices from the
public model list (`GET https://gen.pollinations.ai/v1/models`, Nov 2026);
a full 8-turn conversation on the default models costs a small fraction of
one Pollen. Reasoning models are called with `reasoning_effort: "low"` and a
generous `max_tokens`, with one automatic retry without the reasoning flag
if a model rejects it.

## Run it

It is a static site, no build step:

```sh
# any static server works, for example:
npx serve .
# or just open index.html in a browser
```

Or use the live GitHub Pages deployment once the repo is published (the main
agent fills in the URL at submission time; see SUBMISSION.md).

## Tests

Core logic (turn alternation, the stop condition, transcript building,
message construction, twist handling, key format checks, cost and token
tallying, the demo exchange) lives in `logic.js` as pure functions and is
covered by node tests:

```sh
npm test
# 17 tests, all passing
```

## Files

- `index.html` - page structure
- `style.css` - styling, chat layout, agent colours
- `logic.js` - pure logic shared by the app and the tests (models, personas,
  alternation, message building, tallying, transcript, demo script)
- `app.js` - browser wiring: key handling, the conversation loop, rendering
- `tests/logic.test.mjs` - node tests for `logic.js`
- `SUBMISSION.md` - the app-submission text for quest #19178

## License

MIT, see LICENSE.
