/*
 * AI to AI - core logic.
 * Pure functions, shared by the browser app and the node tests.
 * Two Pollinations text models hold a back-and-forth conversation on a
 * topic the visitor picks. Visitors pay with their own Pollen (BYOP).
 */
(function (root) {
  'use strict';

  var API_URL = 'https://gen.pollinations.ai/v1/chat/completions';
  var BALANCE_URL = 'https://gen.pollinations.ai/account/balance';
  var KEY_STORAGE = 'ai-to-ai-polli-key';

  var MIN_TURNS = 2;
  var MAX_TURNS = 30;
  var DEFAULT_TURNS = 8;

  /*
   * Curated text models. Prices are Pollen per token, taken from the
   * public model list at gen.pollinations.ai/v1/models (Nov 2026).
   * Models missing here still run; their cost tally shows tokens only.
   */
  var MODELS = [
    { id: 'openai/gpt-5.4-nano', lab: 'OpenAI', label: 'GPT-5.4 Nano', prompt: 0.00000015, completion: 0.0000009375 },
    { id: 'openai/gpt-5.5', lab: 'OpenAI', label: 'GPT-5.5', prompt: 0.00000375, completion: 0.0000225 },
    { id: 'openai/gpt-oss-20b', lab: 'OpenAI (open weight)', label: 'GPT-OSS 20B', prompt: 0.00000005, completion: 0.00000018 },
    { id: 'deepseek/deepseek-v4-flash', lab: 'DeepSeek', label: 'DeepSeek V4 Flash', prompt: 0.00000033, completion: 0.00000099 },
    { id: 'z-ai/glm-5.3-flash', lab: 'Z.ai', label: 'GLM 5.3 Flash', prompt: 0.00000015, completion: 0.0000005 },
    { id: 'moonshotai/kimi-k2.6', lab: 'Moonshot AI', label: 'Kimi K2.6', prompt: 0.00000095, completion: 0.000004 },
    { id: 'mistralai/mistral-large-3', lab: 'Mistral AI', label: 'Mistral Large 3', prompt: 0.000000375, completion: 0.000001125 },
    { id: 'meta/llama-3.3-70b-instruct', lab: 'Meta', label: 'Llama 3.3 70B', prompt: 0.0000005325, completion: 0.0000005325 },
    { id: 'x-ai/grok-4.3', lab: 'xAI', label: 'Grok 4.3', prompt: 0.0000009375, completion: 0.000001875 }
  ];

  var DEFAULT_MODEL_A = 'openai/gpt-5.4-nano';
  var DEFAULT_MODEL_B = 'deepseek/deepseek-v4-flash';

  var PERSONAS = [
    {
      id: 'skeptic',
      name: 'The Skeptic',
      prompt: 'a skeptic who questions every claim, asks for evidence, and points out weak assumptions, politely but firmly'
    },
    {
      id: 'optimist',
      name: 'The Optimist',
      prompt: 'an optimist who looks for upside, workable compromises, and reasons things can go well, without ignoring real problems'
    },
    {
      id: 'engineer',
      name: 'The Engineer',
      prompt: 'a pragmatic engineer who thinks in trade-offs, costs, failure modes, and what can actually be built and shipped'
    },
    {
      id: 'scientist',
      name: 'The Scientist',
      prompt: 'a scientist who reasons from first principles, proposes tests and experiments, and separates what is known from what is guessed'
    },
    {
      id: 'poet',
      name: 'The Poet',
      prompt: 'a poet who speaks in concrete images and short vivid lines, but always lands on a clear point about the topic'
    },
    {
      id: 'contrarian',
      name: 'The Contrarian',
      prompt: 'a contrarian who takes the unpopular side on purpose, defends it well, and enjoys flipping the framing of the debate'
    },
    {
      id: 'comedian',
      name: 'The Comedian',
      prompt: 'a dry comedian who makes sharp jokes about the topic while still making a real argument underneath the humour'
    },
    {
      id: 'historian',
      name: 'The Historian',
      prompt: 'a historian who answers with parallels from the past, what was tried before, and how it ended'
    }
  ];

  function modelById(id) {
    for (var i = 0; i < MODELS.length; i++) {
      if (MODELS[i].id === id) return MODELS[i];
    }
    return null;
  }

  function personaById(id) {
    for (var i = 0; i < PERSONAS.length; i++) {
      if (PERSONAS[i].id === id) return PERSONAS[i];
    }
    return PERSONAS[0];
  }

  /* Turn count from the UI: integer, clamped to the supported range. */
  function clampTurns(value) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return DEFAULT_TURNS;
    if (n < MIN_TURNS) return MIN_TURNS;
    if (n > MAX_TURNS) return MAX_TURNS;
    return n;
  }

  /*
   * Alternation: turn index 0, 2, 4... belong to agent 0 and odd indexes
   * to agent 1. messageCount is how many messages exist so far.
   */
  function speakerForTurn(turnIndex) {
    return ((turnIndex % 2) + 2) % 2;
  }

  function nextSpeakerIndex(messageCount) {
    return speakerForTurn(messageCount);
  }

  function countMessages(transcript) {
    var n = 0;
    for (var i = 0; i < transcript.length; i++) {
      if (transcript[i].type === 'message') n += 1;
    }
    return n;
  }

  /* The stop condition for the conversation loop. */
  function shouldContinue(transcript, maxTurns, stopped) {
    if (stopped) return false;
    return countMessages(transcript) < clampTurns(maxTurns);
  }

  /* BYOP key format check. Live checking happens in the app. */
  function validateKey(key) {
    if (typeof key !== 'string') return { ok: false, empty: true, reason: 'No key set.' };
    var k = key.trim();
    if (!k) return { ok: false, empty: true, reason: 'No key set.' };
    if (/\s/.test(k)) return { ok: false, empty: false, reason: 'Key contains spaces. Paste the whole key with nothing around it.' };
    if (!/^(sk|pk)_[A-Za-z0-9_-]{10,}$/.test(k)) {
      return { ok: false, empty: false, reason: 'That does not look like a Pollinations key. Keys start with sk_ or pk_.' };
    }
    return { ok: true, empty: false, reason: 'Key format looks right.' };
  }

  /* Pollen cost estimate from token counts. Null if the model is unpriced. */
  function estimateCostPollen(modelId, promptTokens, completionTokens) {
    var m = modelById(modelId);
    if (!m) return null;
    var p = Number(promptTokens) || 0;
    var c = Number(completionTokens) || 0;
    return p * m.prompt + c * m.completion;
  }

  function emptyTally() {
    return {
      turns: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costPollen: 0,
      costKnown: true,
      latencyMs: 0,
      perAgent: [
        { turns: 0, totalTokens: 0, costPollen: 0 },
        { turns: 0, totalTokens: 0, costPollen: 0 }
      ]
    };
  }

  /* Fold one finished turn into the running tally. Returns the tally. */
  function tallyTurn(tally, entry) {
    var usage = entry.usage || {};
    var prompt = Number(usage.promptTokens) || 0;
    var completion = Number(usage.completionTokens) || 0;
    var total = Number(usage.totalTokens) || (prompt + completion);
    var cost = estimateCostPollen(entry.model, prompt, completion);
    tally.turns += 1;
    tally.promptTokens += prompt;
    tally.completionTokens += completion;
    tally.totalTokens += total;
    tally.latencyMs += Number(entry.latencyMs) || 0;
    if (cost === null) {
      tally.costKnown = false;
    } else {
      tally.costPollen += cost;
    }
    var side = tally.perAgent[entry.speakerIndex === 1 ? 1 : 0];
    side.turns += 1;
    side.totalTokens += total;
    if (cost !== null) side.costPollen += cost;
    if (cost !== null) entry.costPollen = cost;
    return tally;
  }

  function makeEntry(fields) {
    return {
      type: 'message',
      n: fields.n,
      speakerIndex: fields.speakerIndex,
      name: fields.name,
      model: fields.model,
      text: fields.text,
      latencyMs: fields.latencyMs || 0,
      usage: fields.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costPollen: (fields.costPollen === undefined ? null : fields.costPollen),
      demo: !!fields.demo,
      ts: fields.ts || null
    };
  }

  function makeTwist(text) {
    return { type: 'twist', text: String(text || '').trim() };
  }

  /*
   * Build the chat-completions messages for the next speaker.
   * agent speaks next, partner is the other side. Own past lines go in as
   * assistant messages, the partner's lines as user messages, and twists
   * as host instructions.
   */
  function buildMessages(agent, partner, topic, transcript) {
    var system =
      'You are ' + agent.name + ', ' + agent.personaPrompt + '. ' +
      'You are in a live conversation with another AI called ' + partner.name + '. ' +
      'The topic is: ' + topic + '. ' +
      'Keep every reply short, 2 to 4 sentences. Stay in character. ' +
      'Answer what ' + partner.name + ' just said, add something new, and move the conversation forward. ' +
      'Speak only as yourself. No narration, no stage directions, no name prefix.';
    var messages = [{ role: 'system', content: system }];
    var spoken = false;
    for (var i = 0; i < transcript.length; i++) {
      var e = transcript[i];
      if (e.type === 'twist') {
        messages.push({
          role: 'user',
          content: '[The human host throws in a twist: ' + e.text + ' React to it in your next reply.]'
        });
      } else if (e.type === 'message') {
        spoken = true;
        if (e.speakerIndex === agent.speakerIndex) {
          messages.push({ role: 'assistant', content: e.text });
        } else {
          messages.push({ role: 'user', content: partner.name + ': ' + e.text });
        }
      }
    }
    if (!spoken) {
      messages.push({
        role: 'user',
        content: 'Open the conversation now. Topic: ' + topic
      });
    }
    return messages;
  }

  /* Pull the reply text and usage out of a chat-completions response. */
  function extractReply(json) {
    if (!json || !json.choices || !json.choices.length) {
      return { text: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }
    var choice = json.choices[0];
    var msg = choice.message || {};
    var text = (typeof msg.content === 'string' ? msg.content : '') || choice.text || '';
    var u = json.usage || {};
    return {
      text: text.trim(),
      usage: {
        promptTokens: Number(u.prompt_tokens) || 0,
        completionTokens: Number(u.completion_tokens) || 0,
        totalTokens: Number(u.total_tokens) || ((Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0))
      }
    };
  }

  /* Request body. Reasoning models need reasoning_effort low and room. */
  function buildRequestBody(modelId, messages) {
    return {
      model: modelId,
      messages: messages,
      max_tokens: 600,
      reasoning_effort: 'low'
    };
  }

  /*
   * Scripted demo exchange, used when there is no key. Clearly labelled
   * demo in the UI and in the transcript. Deterministic: same inputs give
   * the same lines, so tests can rely on it.
   */
  var DEMO_LINES = [
    'Let me start plain: {topic} sounds simple until you ask who pays for it and who carries the risk when it breaks.',
    'Fair opening, but you skip the upside. If {topic} works even halfway, the people closest to the problem get leverage they never had.',
    'Leverage cuts both ways. Hand someone {topic} without guardrails and the first failure lands on the person least able to absorb it.',
    'Then build the guardrails into it from day one. A thing like {topic} does not need to be perfect, it needs to fail small and in the open.',
    'Fail small is easy to say. In practice the small failures pile up quietly, and by the time anyone counts them, {topic} is already load-bearing.',
    'Which is exactly why you instrument {topic} early. Measure the failures, publish the numbers, and let critics like you audit the pile instead of guessing at it.',
    'On that we agree: numbers over slogans. If {topic} cannot survive an honest audit, it does not deserve to scale.',
    'And if it survives the audit, you have to let it scale, even if it makes the old way of doing things uncomfortable. Deal?',
    'Deal, with one condition: the audit never stops. The day {topic} gets a free pass is the day it starts rotting.',
    'Agreed. Permanent audit, real upside, failures in the open. That is a version of {topic} I can sign.'
  ];

  function demoExchange(topic, agentA, agentB, turns) {
    var n = clampTurns(turns);
    var agents = [agentA, agentB];
    var out = [];
    for (var i = 0; i < n; i++) {
      var speaker = agents[speakerForTurn(i)];
      var line = DEMO_LINES[i % DEMO_LINES.length].split('{topic}').join(topic);
      out.push(makeEntry({
        n: i + 1,
        speakerIndex: speaker.speakerIndex,
        name: speaker.name,
        model: speaker.model,
        text: line,
        latencyMs: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        costPollen: 0,
        demo: true
      }));
    }
    return out;
  }

  /* Plain-text transcript for download and sharing. */
  function buildTranscriptText(session) {
    var lines = [];
    lines.push('# AI to AI - conversation transcript');
    lines.push('');
    lines.push('Topic: ' + session.topic);
    lines.push('Agent A: ' + session.agents[0].name + ' (' + session.agents[0].model + ')');
    lines.push('Agent B: ' + session.agents[1].name + ' (' + session.agents[1].model + ')');
    if (session.demo) lines.push('Mode: DEMO - scripted sample exchange, not live model output.');
    lines.push('');
    for (var i = 0; i < session.transcript.length; i++) {
      var e = session.transcript[i];
      if (e.type === 'twist') {
        lines.push('--- Host twist: ' + e.text + ' ---');
        lines.push('');
      } else {
        var meta = 'turn ' + e.n;
        if (!e.demo) {
          meta += ', ' + (Number(e.latencyMs) || 0) + ' ms';
          if (e.usage && e.usage.totalTokens) meta += ', ' + e.usage.totalTokens + ' tokens';
        }
        lines.push('## ' + e.name + ' (' + meta + ')');
        lines.push(e.text);
        lines.push('');
      }
    }
    var t = session.tally || emptyTally();
    lines.push('---');
    lines.push('Turns: ' + t.turns +
      ' | Tokens: ' + t.totalTokens +
      ' (prompt ' + t.promptTokens + ', completion ' + t.completionTokens + ')' +
      ' | Estimated cost: ' + (t.costKnown ? t.costPollen.toFixed(6) + ' Pollen' : 'partial, one model is unpriced') +
      ' | Total latency: ' + t.latencyMs + ' ms');
    lines.push('Made with Pollinations (gen.pollinations.ai), bring your own Pollen.');
    return lines.join('\n');
  }

  var api = {
    API_URL: API_URL,
    BALANCE_URL: BALANCE_URL,
    KEY_STORAGE: KEY_STORAGE,
    MODELS: MODELS,
    PERSONAS: PERSONAS,
    DEFAULT_MODEL_A: DEFAULT_MODEL_A,
    DEFAULT_MODEL_B: DEFAULT_MODEL_B,
    MIN_TURNS: MIN_TURNS,
    MAX_TURNS: MAX_TURNS,
    DEFAULT_TURNS: DEFAULT_TURNS,
    modelById: modelById,
    personaById: personaById,
    clampTurns: clampTurns,
    speakerForTurn: speakerForTurn,
    nextSpeakerIndex: nextSpeakerIndex,
    countMessages: countMessages,
    shouldContinue: shouldContinue,
    validateKey: validateKey,
    estimateCostPollen: estimateCostPollen,
    emptyTally: emptyTally,
    tallyTurn: tallyTurn,
    makeEntry: makeEntry,
    makeTwist: makeTwist,
    buildMessages: buildMessages,
    buildRequestBody: buildRequestBody,
    extractReply: extractReply,
    demoExchange: demoExchange,
    buildTranscriptText: buildTranscriptText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.AI2AI = api;
})(typeof window !== 'undefined' ? window : globalThis);
