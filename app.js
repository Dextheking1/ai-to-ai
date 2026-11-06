/* AI to AI - browser app. Core logic lives in logic.js (window.AI2AI). */
(function () {
  'use strict';
  var L = window.AI2AI;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    key: $('keyInput'), keyStatus: $('keyStatus'),
    personaA: $('personaA'), personaB: $('personaB'),
    promptA: $('promptA'), promptB: $('promptB'),
    modelA: $('modelA'), modelB: $('modelB'),
    customA: $('customModelA'), customB: $('customModelB'),
    topic: $('topicInput'), turns: $('turnsInput'),
    start: $('startBtn'), stop: $('stopBtn'), download: $('downloadBtn'),
    twist: $('twistInput'), twistBtn: $('twistBtn'),
    status: $('statusLine'), chat: $('chat'), demoBanner: $('demoBanner'),
    statTurns: $('statTurns'), statTokens: $('statTokens'), statCost: $('statCost'),
    statLatency: $('statLatency'), statSplit: $('statSplit')
  };

  var QUICK_TOPICS = [
    'Should a small town replace its bus fleet with self-driving shuttles?',
    'Is a four-day work week good for a small software team?',
    'Should cities ban cars from the centre?',
    'Would you rather live on a space station or under the ocean?',
    'Should homework exist?',
    'Can a machine ever really be creative?'
  ];

  var state = {
    running: false,
    stopped: false,
    demo: false,
    topic: '',
    agents: [],
    transcript: [],
    tally: L.emptyTally(),
    pendingTwists: [],
    abort: null
  };

  /* ---------- setup ---------- */

  function fillPersonas(select, defaultId) {
    L.PERSONAS.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
    select.value = defaultId;
  }

  function fillModels(select, defaultId) {
    L.MODELS.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label + ' - ' + m.lab + ' (' + m.id + ')';
      select.appendChild(opt);
    });
    var custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = 'Custom model id...';
    select.appendChild(custom);
    select.value = defaultId;
  }

  function syncPrompt(which) {
    var select = which === 0 ? els.personaA : els.personaB;
    var area = which === 0 ? els.promptA : els.promptB;
    area.value = L.personaById(select.value).prompt;
  }

  function syncCustom(which) {
    var select = which === 0 ? els.modelA : els.modelB;
    var input = which === 0 ? els.customA : els.customB;
    input.hidden = select.value !== '__custom__';
  }

  function readAgent(which) {
    var persona = L.personaById((which === 0 ? els.personaA : els.personaB).value);
    var select = which === 0 ? els.modelA : els.modelB;
    var custom = which === 0 ? els.customA : els.customB;
    var model = select.value === '__custom__' ? (custom.value.trim() || L.DEFAULT_MODEL_A) : select.value;
    return {
      speakerIndex: which,
      name: persona.name,
      personaPrompt: (which === 0 ? els.promptA : els.promptB).value.trim() || persona.prompt,
      model: model
    };
  }

  /* ---------- key handling ---------- */

  function savedKey() {
    try { return localStorage.getItem(L.KEY_STORAGE) || ''; } catch (e) { return ''; }
  }

  function setKeyStatus(text, kind) {
    els.keyStatus.textContent = text;
    els.keyStatus.className = 'hint' + (kind ? ' ' + kind : '');
  }

  function refreshKeyStatus() {
    var key = savedKey();
    if (!key) {
      setKeyStatus('No key saved. The app runs in demo mode with a scripted sample until you add one. Get a key at enter.pollinations.ai/keys. Your key stays in this browser (localStorage) and is only ever sent to gen.pollinations.ai.');
      return;
    }
    setKeyStatus('Key saved in this browser only. Live mode is on: conversations bill your Pollen.', 'ok');
  }

  function saveKey() {
    var value = els.key.value.trim();
    if (!value) {
      try { localStorage.removeItem(L.KEY_STORAGE); } catch (e) {}
      refreshKeyStatus();
      return;
    }
    var check = L.validateKey(value);
    if (!check.ok) { setKeyStatus(check.reason, 'bad'); return; }
    try { localStorage.setItem(L.KEY_STORAGE, value); } catch (e) {}
    els.key.value = '';
    setKeyStatus('Saved. ' + check.reason + ' Live mode is on.', 'ok');
  }

  function testKey() {
    var key = savedKey() || els.key.value.trim();
    var check = L.validateKey(key);
    if (!check.ok) { setKeyStatus(check.reason, 'bad'); return; }
    setKeyStatus('Testing key...');
    fetch(L.BALANCE_URL, { headers: { Authorization: 'Bearer ' + key } })
      .then(function (res) {
        if (res.status === 200) {
          return res.json().then(function (data) {
            var bal = data && (data.balance !== undefined ? data.balance : (data.accountBalance && data.accountBalance.total));
            setKeyStatus('Key works. Account balance: ' + (bal !== undefined ? bal + ' Pollen' : 'read ok') + '.', 'ok');
          });
        }
        if (res.status === 401 || res.status === 403) {
          setKeyStatus('Key rejected by Pollinations (HTTP ' + res.status + '). Check the key and its permissions.', 'bad');
          return null;
        }
        setKeyStatus('Key endpoint answered HTTP ' + res.status + '. The key format is right; try a conversation to be sure.');
        return null;
      })
      .catch(function () { setKeyStatus('Could not reach gen.pollinations.ai to test the key.'); });
  }

  /* ---------- rendering ---------- */

  function renderStats() {
    var t = state.tally;
    els.statTurns.textContent = String(t.turns);
    els.statTokens.textContent = String(t.totalTokens);
    els.statCost.textContent = t.costPollen.toFixed(6) + (t.costKnown ? '' : ' +');
    els.statLatency.textContent = t.latencyMs + ' ms';
    els.statSplit.textContent = t.perAgent[0].totalTokens + ' / ' + t.perAgent[1].totalTokens;
  }

  function scrollChat() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function renderTwist(entry) {
    var div = document.createElement('div');
    div.className = 'twist-banner';
    div.textContent = 'Host twist: ' + entry.text;
    els.chat.appendChild(div);
  }

  function renderMessage(entry) {
    var div = document.createElement('div');
    div.className = 'msg ' + (entry.speakerIndex === 0 ? 'msg-a' : 'msg-b');
    var meta = document.createElement('div');
    meta.className = 'meta';
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = entry.name;
    meta.appendChild(who);
    var bits = ' - turn ' + entry.n + ' - ' + entry.model;
    if (entry.demo) bits += ' - demo';
    else {
      bits += ' - ' + entry.latencyMs + ' ms';
      if (entry.usage && entry.usage.totalTokens) bits += ' - ' + entry.usage.totalTokens + ' tokens';
      if (entry.costPollen !== null && entry.costPollen !== undefined) bits += ' - ~' + entry.costPollen.toFixed(6) + ' Pollen';
    }
    meta.appendChild(document.createTextNode(bits));
    var body = document.createElement('div');
    body.className = 'body';
    body.textContent = entry.text;
    div.appendChild(meta);
    div.appendChild(body);
    els.chat.appendChild(div);
    return div;
  }

  function renderThinking(agent) {
    var div = document.createElement('div');
    div.className = 'msg thinking ' + (agent.speakerIndex === 0 ? 'msg-a' : 'msg-b');
    div.textContent = agent.name + ' (' + agent.model + ') is thinking...';
    els.chat.appendChild(div);
    scrollChat();
    return div;
  }

  function renderError(text) {
    var div = document.createElement('div');
    div.className = 'error-banner';
    div.textContent = text;
    els.chat.appendChild(div);
  }

  function setStatus(text) { els.status.textContent = text; }

  function setRunning(running) {
    state.running = running;
    els.start.disabled = running;
    els.stop.disabled = !running;
    els.download.disabled = state.transcript.length === 0;
  }

  /* ---------- Pollinations call ---------- */

  function callModel(key, agent, messages) {
    var body = L.buildRequestBody(agent.model, messages);
    var started = performance.now();
    function attempt(payload) {
      return fetch(L.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(payload),
        signal: state.abort ? state.abort.signal : undefined
      }).then(function (res) {
        return res.text().then(function (raw) {
          if (res.ok) {
            var json;
            try { json = JSON.parse(raw); } catch (e) { throw new Error('Model returned non-JSON output.'); }
            return { json: json, latencyMs: Math.round(performance.now() - started) };
          }
          // Reasoning-only parameters can 400 on some models. Retry once without.
          if (res.status === 400 && payload.reasoning_effort) {
            var lean = { model: payload.model, messages: payload.messages, max_tokens: payload.max_tokens };
            return attempt(lean);
          }
          var detail = raw.slice(0, 220);
          throw new Error('Pollinations HTTP ' + res.status + (detail ? ': ' + detail : ''));
        });
      });
    }
    return attempt(body);
  }

  /* ---------- conversation loop ---------- */

  function finishRun(note) {
    state.abort = null;
    setRunning(false);
    els.download.disabled = state.transcript.length === 0;
    setStatus(note);
    scrollChat();
  }

  function runDemo(maxTurns) {
    var entries = L.demoExchange(state.topic, state.agents[0], state.agents[1], maxTurns);
    var i = 0;
    function step() {
      if (state.stopped || i >= entries.length || !L.shouldContinue(state.transcript, maxTurns, state.stopped)) {
        finishRun(state.stopped ? 'Stopped. Demo transcript is ready to download.' : 'Demo finished. Add a key for a live conversation, or download the sample.');
        return;
      }
      var entry = entries[i];
      i += 1;
      state.transcript.push(entry);
      L.tallyTurn(state.tally, entry);
      renderMessage(entry);
      renderStats();
      scrollChat();
      setTimeout(step, 650);
    }
    step();
  }

  function runLive(key, maxTurns) {
    function step() {
      if (!L.shouldContinue(state.transcript, maxTurns, state.stopped)) {
        finishRun(state.stopped ? 'Stopped by you. Partial transcript is ready to download.' : 'Conversation finished. Transcript is ready to download.');
        return;
      }
      var speakerIndex = L.nextSpeakerIndex(L.countMessages(state.transcript));
      var agent = state.agents[speakerIndex];
      var partner = state.agents[1 - speakerIndex];
      var messages = L.buildMessages(agent, partner, state.topic, state.transcript);
      var thinking = renderThinking(agent);
      state.abort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      callModel(key, agent, messages)
        .then(function (result) {
          thinking.remove();
          var reply = L.extractReply(result.json);
          if (!reply.text) throw new Error(agent.name + ' returned an empty reply. Stopping here.');
          var entry = L.makeEntry({
            n: L.countMessages(state.transcript) + 1,
            speakerIndex: speakerIndex,
            name: agent.name,
            model: agent.model,
            text: reply.text,
            latencyMs: result.latencyMs,
            usage: reply.usage,
            ts: new Date().toISOString()
          });
          state.transcript.push(entry);
          L.tallyTurn(state.tally, entry);
          renderMessage(entry);
          renderStats();
          scrollChat();
          setTimeout(step, 250);
        })
        .catch(function (err) {
          thinking.remove();
          if (err && err.name === 'AbortError') {
            finishRun('Stopped by you. Partial transcript is ready to download.');
            return;
          }
          renderError('Stopped early: ' + (err && err.message ? err.message : String(err)));
          finishRun('Stopped early after an error. Partial transcript is ready to download.');
        });
    }
    step();
  }

  function start() {
    var topic = els.topic.value.trim();
    if (!topic) { setStatus('Give them a topic first.'); els.topic.focus(); return; }
    var maxTurns = L.clampTurns(els.turns.value);
    els.turns.value = String(maxTurns);
    state.topic = topic;
    state.agents = [readAgent(0), readAgent(1)];
    state.transcript = [];
    state.tally = L.emptyTally();
    state.stopped = false;
    els.chat.innerHTML = '';
    state.pendingTwists.forEach(function (text) {
      var twist = L.makeTwist(text);
      state.transcript.push(twist);
      renderTwist(twist);
    });
    state.pendingTwists = [];
    renderStats();

    var key = savedKey();
    state.demo = !L.validateKey(key).ok;
    els.demoBanner.hidden = !state.demo;
    setRunning(true);
    els.download.disabled = true;
    if (state.demo) {
      setStatus('Demo mode: no valid key saved, running the scripted sample.');
      runDemo(maxTurns);
    } else {
      setStatus('Live: ' + state.agents[0].name + ' (' + state.agents[0].model + ') vs ' + state.agents[1].name + ' (' + state.agents[1].model + '), ' + maxTurns + ' turns.');
      runLive(key, maxTurns);
    }
  }

  function stop() {
    state.stopped = true;
    if (state.abort) state.abort.abort();
    setStatus('Stopping after the current turn...');
  }

  function injectTwist() {
    var text = els.twist.value.trim();
    if (!text) return;
    els.twist.value = '';
    if (!state.running && state.transcript.length === 0) {
      state.pendingTwists.push(text);
      setStatus('Twist queued. It will land at the start of the next conversation.');
      return;
    }
    var twist = L.makeTwist(text);
    state.transcript.push(twist);
    renderTwist(twist);
    scrollChat();
    setStatus(state.running ? 'Twist in. The next speaker has to deal with it.' : 'Twist added to the transcript. Start a new conversation to play one live.');
  }

  function download() {
    var text = L.buildTranscriptText({
      topic: state.topic,
      agents: state.agents.length ? state.agents : [readAgent(0), readAgent(1)],
      transcript: state.transcript,
      tally: state.tally,
      demo: state.demo
    });
    var blob = new Blob([text], { type: 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ai-to-ai-transcript.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------- wiring ---------- */

  fillPersonas(els.personaA, 'skeptic');
  fillPersonas(els.personaB, 'optimist');
  fillModels(els.modelA, L.DEFAULT_MODEL_A);
  fillModels(els.modelB, L.DEFAULT_MODEL_B);
  syncPrompt(0);
  syncPrompt(1);

  QUICK_TOPICS.forEach(function (topic) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.textContent = topic;
    chip.addEventListener('click', function () { els.topic.value = topic; });
    $('quickTopics').appendChild(chip);
  });

  els.personaA.addEventListener('change', function () { syncPrompt(0); });
  els.personaB.addEventListener('change', function () { syncPrompt(1); });
  els.modelA.addEventListener('change', function () { syncCustom(0); });
  els.modelB.addEventListener('change', function () { syncCustom(1); });
  $('saveKeyBtn').addEventListener('click', saveKey);
  $('testKeyBtn').addEventListener('click', testKey);
  $('clearKeyBtn').addEventListener('click', function () {
    try { localStorage.removeItem(L.KEY_STORAGE); } catch (e) {}
    els.key.value = '';
    refreshKeyStatus();
  });
  els.start.addEventListener('click', start);
  els.stop.addEventListener('click', stop);
  els.download.addEventListener('click', download);
  els.twistBtn.addEventListener('click', injectTwist);
  els.twist.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') injectTwist(); });

  refreshKeyStatus();
  renderStats();
})();
