// Tests for the pure logic in logic.js. Run: node tests/logic.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const L = require('../logic.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok -', name);
}

const agentA = { speakerIndex: 0, name: 'The Skeptic', personaPrompt: L.personaById('skeptic').prompt, model: L.DEFAULT_MODEL_A };
const agentB = { speakerIndex: 1, name: 'The Optimist', personaPrompt: L.personaById('optimist').prompt, model: L.DEFAULT_MODEL_B };

check('defaults use two different labs', () => {
  const a = L.modelById(L.DEFAULT_MODEL_A);
  const b = L.modelById(L.DEFAULT_MODEL_B);
  assert.ok(a && b);
  assert.notEqual(a.lab, b.lab);
});

check('clampTurns clamps and defaults', () => {
  assert.equal(L.clampTurns(8), 8);
  assert.equal(L.clampTurns(1), L.MIN_TURNS);
  assert.equal(L.clampTurns(999), L.MAX_TURNS);
  assert.equal(L.clampTurns('nope'), L.DEFAULT_TURNS);
  assert.equal(L.clampTurns('12'), 12);
});

check('turn alternation: A starts, then B, then A', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(L.speakerForTurn), [0, 1, 0, 1, 0, 1]);
  assert.equal(L.nextSpeakerIndex(0), 0);
  assert.equal(L.nextSpeakerIndex(1), 1);
  assert.equal(L.nextSpeakerIndex(2), 0);
});

check('stop condition: max turns reached stops the loop', () => {
  const t = L.demoExchange('robots', agentA, agentB, 4);
  assert.equal(L.countMessages(t), 4);
  assert.equal(L.shouldContinue(t, 4, false), false);
  assert.equal(L.shouldContinue(t.slice(0, 2), 4, false), true);
});

check('stop condition: stopped flag stops the loop at any point', () => {
  assert.equal(L.shouldContinue([], 8, true), false);
  const t = L.demoExchange('robots', agentA, agentB, 2);
  assert.equal(L.shouldContinue(t, 8, true), false);
  assert.equal(L.shouldContinue(t, 8, false), true);
});

check('twists do not count as turns', () => {
  const t = [L.makeTwist('make it about money'), ...L.demoExchange('robots', agentA, agentB, 2)];
  assert.equal(L.countMessages(t), 2);
  assert.equal(L.shouldContinue(t, 4, false), true);
});

check('validateKey accepts sk_ and pk_, rejects junk and empty', () => {
  assert.equal(L.validateKey('sk_' + 'a'.repeat(24)).ok, true);
  assert.equal(L.validateKey('pk_' + 'Z9_-'.repeat(6)).ok, true);
  assert.equal(L.validateKey('').empty, true);
  assert.equal(L.validateKey('   ').empty, true);
  assert.equal(L.validateKey('hello world').ok, false);
  assert.equal(L.validateKey('sk_short').ok, false);
  assert.equal(L.validateKey('sk_' + 'a'.repeat(24) + ' extra').ok, false);
});

check('estimateCostPollen uses the price table, null for unpriced models', () => {
  const cost = L.estimateCostPollen('openai/gpt-5.4-nano', 1000000, 1000000);
  assert.ok(Math.abs(cost - (0.15 + 0.9375)) < 1e-9);
  assert.equal(L.estimateCostPollen('some/unknown-model', 100, 100), null);
  assert.equal(L.estimateCostPollen('openai/gpt-5.4-nano', 0, 0), 0);
});

check('tallyTurn accumulates tokens, cost and latency per agent', () => {
  const tally = L.emptyTally();
  const e1 = L.makeEntry({ n: 1, speakerIndex: 0, name: 'The Skeptic', model: 'openai/gpt-5.4-nano', text: 'hi', latencyMs: 500, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } });
  const e2 = L.makeEntry({ n: 2, speakerIndex: 1, name: 'The Optimist', model: 'deepseek/deepseek-v4-flash', text: 'yo', latencyMs: 700, usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 } });
  L.tallyTurn(tally, e1);
  L.tallyTurn(tally, e2);
  assert.equal(tally.turns, 2);
  assert.equal(tally.promptTokens, 300);
  assert.equal(tally.completionTokens, 130);
  assert.equal(tally.totalTokens, 430);
  assert.equal(tally.latencyMs, 1200);
  assert.equal(tally.perAgent[0].turns, 1);
  assert.equal(tally.perAgent[1].turns, 1);
  assert.equal(tally.perAgent[0].totalTokens, 150);
  assert.ok(tally.costPollen > 0);
  assert.equal(tally.costKnown, true);
  assert.ok(e1.costPollen > 0);
});

check('tallyTurn flags partial cost when a model is unpriced', () => {
  const tally = L.emptyTally();
  const e = L.makeEntry({ n: 1, speakerIndex: 0, name: 'X', model: 'custom/model-x', text: 'hi', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
  L.tallyTurn(tally, e);
  assert.equal(tally.costKnown, false);
  assert.equal(tally.totalTokens, 15);
});

check('buildMessages: opener, history roles, in-character system prompt', () => {
  const opener = L.buildMessages(agentA, agentB, 'space farming', []);
  assert.equal(opener[0].role, 'system');
  assert.match(opener[0].content, /The Skeptic/);
  assert.match(opener[0].content, /space farming/);
  assert.equal(opener[opener.length - 1].role, 'user');
  assert.match(opener[opener.length - 1].content, /Open the conversation/);

  const history = [
    L.makeEntry({ n: 1, speakerIndex: 0, name: 'The Skeptic', model: agentA.model, text: 'first line' }),
    L.makeEntry({ n: 2, speakerIndex: 1, name: 'The Optimist', model: agentB.model, text: 'second line' })
  ];
  const msgs = L.buildMessages(agentA, agentB, 'space farming', history);
  // system, then own line as assistant, then partner line as user
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content, 'first line');
  assert.equal(msgs[2].role, 'user');
  assert.match(msgs[2].content, /The Optimist: second line/);
});

check('buildMessages: a twist becomes a host instruction', () => {
  const history = [
    L.makeEntry({ n: 1, speakerIndex: 0, name: 'The Skeptic', model: agentA.model, text: 'first line' }),
    L.makeTwist('now argue the opposite')
  ];
  const msgs = L.buildMessages(agentB, agentA, 'space farming', history);
  const twist = msgs.find((m) => /twist/i.test(m.content));
  assert.ok(twist);
  assert.match(twist.content, /argue the opposite/);
});

check('buildRequestBody carries reasoning_effort low and token room', () => {
  const body = L.buildRequestBody('openai/gpt-5.4-nano', [{ role: 'user', content: 'x' }]);
  assert.equal(body.model, 'openai/gpt-5.4-nano');
  assert.equal(body.reasoning_effort, 'low');
  assert.ok(body.max_tokens >= 300);
});

check('extractReply reads content and usage, tolerates junk', () => {
  const r = L.extractReply({ choices: [{ message: { content: '  hello  ' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  assert.equal(r.text, 'hello');
  assert.equal(r.usage.totalTokens, 15);
  const empty = L.extractReply(null);
  assert.equal(empty.text, '');
  assert.equal(empty.usage.totalTokens, 0);
  const noTotal = L.extractReply({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
  assert.equal(noTotal.usage.totalTokens, 7);
});

check('demoExchange: right length, alternates, labelled demo, deterministic', () => {
  const run1 = L.demoExchange('urban farming', agentA, agentB, 6);
  const run2 = L.demoExchange('urban farming', agentA, agentB, 6);
  assert.equal(run1.length, 6);
  assert.deepEqual(run1.map((e) => e.speakerIndex), [0, 1, 0, 1, 0, 1]);
  assert.ok(run1.every((e) => e.demo === true));
  assert.ok(run1.every((e) => e.text.includes('urban farming')));
  assert.deepEqual(run1.map((e) => e.text), run2.map((e) => e.text));
});

check('buildTranscriptText includes topic, turns, twist and totals', () => {
  const transcript = [
    L.makeEntry({ n: 1, speakerIndex: 0, name: 'The Skeptic', model: agentA.model, text: 'opening shot', latencyMs: 420, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
    L.makeTwist('bring up the money'),
    L.makeEntry({ n: 2, speakerIndex: 1, name: 'The Optimist', model: agentB.model, text: 'bright reply', latencyMs: 380, usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 } })
  ];
  const tally = L.emptyTally();
  transcript.filter((e) => e.type === 'message').forEach((e) => L.tallyTurn(tally, e));
  const text = L.buildTranscriptText({ topic: 'urban farming', agents: [agentA, agentB], transcript, tally, demo: false });
  assert.match(text, /Topic: urban farming/);
  assert.match(text, /The Skeptic/);
  assert.match(text, /opening shot/);
  assert.match(text, /Host twist: bring up the money/);
  assert.match(text, /Turns: 2/);
  assert.match(text, /Tokens: 33/);
  assert.match(text, /Estimated cost:/);
});

check('buildTranscriptText flags demo mode', () => {
  const transcript = L.demoExchange('robots', agentA, agentB, 2);
  const text = L.buildTranscriptText({ topic: 'robots', agents: [agentA, agentB], transcript, tally: L.emptyTally(), demo: true });
  assert.match(text, /DEMO - scripted sample/);
});

console.log('\n' + passed + ' tests passed');
