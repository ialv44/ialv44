const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');

const state = { view: 'overview', overview: null, pods: [], members: [], nudges: [], me: null, busy: false };

const api = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
};

// Everything user- or agent-supplied goes through here before it reaches the DOM.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const title = (s) => String(s ?? '').replace(/(^|\s|-)([a-z])/g, (m, a, b) => a + b.toUpperCase());
const when = (r) => `${title(r.day)} ${r.window}s, ${r.time}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const dayLabel = (iso) => {
  if (!iso) return '—';
  const days = Math.round((new Date(iso) - Date.now()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 0) return `in ${plural(days, 'day')}`;
  return `${plural(-days, 'day')} ago`;
};

async function refresh() {
  const [overview, pods, members, nudges] = await Promise.all([
    api('GET', '/api/overview'),
    api('GET', '/api/pods'),
    api('GET', '/api/members'),
    api('GET', '/api/nudges?status=pending'),
  ]);
  Object.assign(state, { overview, pods, members, nudges });

  $('#c-pods').textContent = pods.length || '';
  $('#c-waiting').textContent = overview.unpodded || '';
  $('#c-nudges').textContent = nudges.length || '';
  $('#agent-status').innerHTML = overview.agentOnline
    ? '<span class="dot on"></span>Agent online'
    : '<span class="dot off"></span>Agent offline — writing from templates. Set ANTHROPIC_API_KEY for the real voice.';
  render();
}

// --- views -----------------------------------------------------------------

const views = {
  overview() {
    const o = state.overview;
    if (!o.members) {
      return `<h1>Nobody here yet</h1>
        <p class="lede">Thirdplace needs a few people in the same city before it can do anything useful.
        Load the demo cohort to see how it forms groups, or join as yourself.</p>
        <div class="row"><button class="action" onclick="document.querySelector('#btn-demo').click()">Load demo cohort</button></div>`;
    }
    const stat = (n, k) => `<div class="stat"><div class="n">${n}</div><div class="k">${k}</div></div>`;
    return `
      <h1>Overview</h1>
      <p class="lede">Pods of four to six, one standing time each. The agent watches whether they are
      still meeting and says something when they are not.</p>
      <div class="stats">
        ${stat(o.members, 'people')}
        ${stat(o.pods, 'pods')}
        ${stat(o.unpodded, 'still waiting')}
        ${stat(o.meetups, 'meet-ups held')}
        ${stat(o.pendingNudges, 'nudges queued')}
      </div>
      <h2>Cities</h2>
      <div class="row">${o.cities.map((c) => `<span class="pill">${esc(c)}</span>`).join('') || '<span class="meta">none</span>'}</div>
      <h2>Pod health</h2>
      ${o.podHealth.length
        ? o.podHealth.map((p) => `
          <div class="card">
            <div class="card-head">
              <h3>${esc(p.name)}</h3>
              <span class="pill ${p.state}">${p.state}</span>
            </div>
            <div class="meta">${plural(p.held, 'meet-up')} held ·
              ${p.daysSinceLast === null ? 'never met' : `last ${plural(p.daysSinceLast, 'day')} ago`} ·
              ${Math.round(p.attendanceRate * 100)}% turnout</div>
          </div>`).join('')
        : '<div class="empty">No pods yet.</div>'}`;
  },

  pods() {
    if (!state.pods.length) {
      return `<h1>Pods</h1><div class="empty">No pods yet. Run the agent once there are four or more
        compatible people in one city.</div>`;
    }
    return `<h1>Pods</h1>
      <p class="lede">Each pod has one fixed time and one fixed kind of place. Quorum, not attendance:
      nobody has to make every week for it to still be worth showing up.</p>
      ${state.pods.map(podCard).join('')}`;
  },

  waiting() {
    const waiting = state.members.filter((m) => !m.podId);
    return `<h1>Waiting</h1>
      <p class="lede">People without a pod, and the actual reason why. This is the part most apps hide.</p>
      ${waiting.length
        ? waiting.map((m) => `
          <div class="card">
            <div class="card-head">
              <h3>${esc(m.displayName)}</h3>
              <span class="meta">${esc(m.city || 'no city')}${m.monthsInCity != null ? ` · ${plural(m.monthsInCity, 'month')} in` : ''}</span>
            </div>
            <div class="why" data-waiting="${esc(m.id)}">…</div>
          </div>`).join('')
        : '<div class="empty">Everyone is in a pod.</div>'}`;
  },

  nudges() {
    return `<h1>Nudges</h1>
      <p class="lede">The agent only writes when the deterministic rules say there is something worth
      saying. No streaks, no daily prompts.</p>
      ${state.nudges.length
        ? state.nudges.map((n) => `
          <div class="card">
            <div class="card-head">
              <h3>${esc(n.title)}</h3>
              <span class="pill">${esc(n.kind)}</span>
            </div>
            <div class="meta">to ${n.audienceIds.map((id) => esc(nameOf(id))).join(', ')}
              ${n.agentOffline ? '· <span class="pill offline">template</span>' : ''}</div>
            <p class="quote">${esc(n.body)}</p>
            ${n.action ? `<p class="why"><b>${esc(n.action)}</b></p>` : ''}
            <div class="row" style="margin-top:12px">
              <button class="action ghost" data-resolve="${esc(n.id)}" data-status="sent">Send</button>
              <button class="action ghost" data-resolve="${esc(n.id)}" data-status="dismissed">Dismiss</button>
            </div>
          </div>`).join('')
        : '<div class="empty">Nothing worth saying right now. That is the intended state.</div>'}`;
  },

  join() {
    const me = state.me;
    if (!me) {
      return `<h1>Join</h1>
        <p class="lede">The agent asks one thing at a time. Availability matters more than hobbies —
        a group with no shared free hour is a group that never meets.</p>
        <div class="card">
          <div class="composer">
            <input id="join-name" placeholder="What should people call you?" autocomplete="off" />
            <button class="action" id="join-go">Start</button>
          </div>
        </div>`;
    }
    const transcript = me.profile.onboarding?.transcript || [];
    return `<h1>${esc(me.profile.displayName || 'Joining')}</h1>
      <p class="lede">${me.completeness >= 0.85
        ? 'Profile is complete enough to match. Run the agent to look for a pod.'
        : `Profile ${Math.round(me.completeness * 100)}% complete.`}</p>
      <div class="card">
        <div class="chat" id="chat">
          ${transcript.map((t) => `<div class="msg ${t.role === 'user' ? 'user' : 'agent'}">${esc(t.text)}</div>`).join('')
            || '<div class="msg agent">Tell me anything — I will ask for the rest.</div>'}
        </div>
        <div class="composer">
          <input id="chat-input" placeholder="Type your answer…" autocomplete="off" />
          <button class="action" id="chat-go">Send</button>
        </div>
      </div>
      ${me.pod ? podCard(me.pod) : `<div class="card"><h3>No pod yet</h3>
        <p class="why">${esc(me.waiting?.detail || 'still looking')}</p></div>`}
      <div class="row"><button class="action ghost" id="join-reset">Join as someone else</button></div>`;
  },
};

function podCard(pod) {
  const m = pod.momentum;
  const top = (pod.warmth || []).slice(0, 4);
  return `
    <div class="card">
      <div class="card-head">
        <h3>${esc(pod.name)}</h3>
        <span class="pill ${m.state}">${m.state}</span>
      </div>
      <div class="meta">${esc(pod.city)} · ${plural(pod.memberIds.length, 'person').replace('persons', 'people')} ·
        fit ${Math.round(pod.cohesion * 100)}%${pod.agentOffline ? ' · <span class="pill offline">template copy</span>' : ''}</div>

      <div class="ritual">
        <b>${esc(pod.ritual.name || 'The standing thing')}</b> —
        <span class="when">${esc(when(pod.ritual))}</span> at ${esc(pod.ritual.venue.label)}.<br />
        Next one ${esc(dayLabel(pod.nextAt))}. Quorum ${pod.ritual.quorum} of ${pod.memberIds.length} —
        ${esc(pod.ritual.venue.why)}.
        ${pod.ritual.anchorPrompt ? `<br /><span class="meta">Anchor: ${esc(pod.ritual.anchorPrompt)}</span>` : ''}
      </div>

      <div class="people">
        ${pod.members.map((p) => `<span class="person" data-member="${esc(p.id)}">${esc(p.displayName)}
          <span class="sub">${p.monthsInCity != null ? `${p.monthsInCity}mo` : ''}</span></span>`).join('')}
      </div>

      <p class="why">${esc(pod.why)}</p>
      ${pod.firstStep ? `<p class="quote">${esc(pod.firstStep)}</p>` : ''}
      ${pod.warnings?.length ? `<p class="meta" style="margin-top:10px">Flagged: ${pod.warnings.map(esc).join(', ')}</p>` : ''}

      ${top.length ? `<div class="bars">
        ${top.map((w) => `<div class="bar">
          <span>${esc(nameOf(w.pair[0]))} &amp; ${esc(nameOf(w.pair[1]))}</span>
          <span class="track"><span class="fill" style="width:${Math.min(100, w.score * 25)}%"></span></span>
          <span class="val">${w.counts['co-attend']}×</span>
        </div>`).join('')}
      </div>` : ''}

      <div class="row" style="margin-top:14px">
        <button class="action ghost" data-met="${esc(pod.id)}">Log a meet-up</button>
      </div>
    </div>`;
}

function nameOf(id) {
  return state.members.find((m) => m.id === id)?.displayName || id;
}

function render() {
  main.innerHTML = views[state.view]();
  document.querySelectorAll('nav button[data-view]').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.view === state.view));
  });
  if (state.view === 'waiting') fillWaitingReasons();
  const chat = $('#chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

async function fillWaitingReasons() {
  for (const el of document.querySelectorAll('[data-waiting]')) {
    try {
      const view = await api('GET', `/api/members/${el.dataset.waiting}`);
      el.textContent = view.waiting?.detail || 'still looking';
    } catch {
      el.textContent = 'still looking';
    }
  }
}

async function busy(btn, fn) {
  if (state.busy) return;
  state.busy = true;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
  try {
    await fn();
  } catch (err) {
    main.insertAdjacentHTML('afterbegin', `<div class="err">${esc(err.message)}</div>`);
  } finally {
    state.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// --- events ----------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('nav button[data-view]');
  if (nav) { state.view = nav.dataset.view; return render(); }

  const tick = e.target.closest('#btn-tick');
  if (tick) return busy(tick, async () => { await api('POST', '/api/tick'); await refresh(); });

  const demo = e.target.closest('#btn-demo');
  if (demo) return busy(demo, async () => {
    await api('POST', '/api/demo');
    state.me = null;
    localStorage.removeItem('thirdplace.me');
    await refresh();
  });

  const resolve = e.target.closest('[data-resolve]');
  if (resolve) return busy(resolve, async () => {
    await api('POST', `/api/nudges/${resolve.dataset.resolve}/resolve`, { status: resolve.dataset.status });
    await refresh();
  });

  const met = e.target.closest('[data-met]');
  if (met) return busy(met, async () => {
    const pod = state.pods.find((p) => p.id === met.dataset.met);
    const attendedIds = pod.memberIds.slice(0, pod.ritual.quorum);
    await api('POST', `/api/pods/${pod.id}/meetups`, { at: new Date().toISOString(), attendedIds });
    await refresh();
  });

  const person = e.target.closest('[data-member]');
  if (person) return showMember(person.dataset.member);

  const joinGo = e.target.closest('#join-go');
  if (joinGo) return busy(joinGo, async () => {
    const name = $('#join-name').value.trim();
    if (!name) return;
    const m = await api('POST', '/api/members', { displayName: name });
    localStorage.setItem('thirdplace.me', m.id);
    await loadMe();
  });

  const chatGo = e.target.closest('#chat-go');
  if (chatGo) return sendChat(chatGo);

  const reset = e.target.closest('#join-reset');
  if (reset) { localStorage.removeItem('thirdplace.me'); state.me = null; return render(); }

  if (e.target.closest('#detail-close')) $('#detail').close();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'chat-input') sendChat($('#chat-go'));
  if (e.target.id === 'join-name') $('#join-go')?.click();
});

async function sendChat(btn) {
  const input = $('#chat-input');
  const text = input?.value.trim();
  if (!text || !state.me) return;
  input.value = '';
  $('#chat').insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div>`);
  $('#chat').scrollTop = $('#chat').scrollHeight;
  await busy(btn, async () => {
    await api('POST', `/api/members/${state.me.profile.id}/chat`, { text });
    await loadMe();
  });
}

async function loadMe() {
  const id = localStorage.getItem('thirdplace.me');
  if (!id) { state.me = null; return refresh(); }
  try {
    state.me = await api('GET', `/api/members/${id}`);
  } catch {
    localStorage.removeItem('thirdplace.me');
    state.me = null;
  }
  state.view = 'join';
  await refresh();
}

async function showMember(id) {
  const me = await api('GET', `/api/members/${id}`);
  const p = me.profile;
  $('#detail-body').innerHTML = `
    <h3 style="margin:0 0 4px">${esc(p.displayName)}</h3>
    <div class="meta">${esc(p.neighborhood || p.city)} · from ${esc(p.homeCountry || 'elsewhere')}</div>
    <div class="ritual" style="margin-top:14px">
      <b>Free</b> ${p.availability.map((a) => `${title(a.day)} ${a.window}`).join(', ') || 'unspecified'}<br />
      <b>Speaks</b> ${p.languages.map((l) => `${esc(l.code)} (${esc(l.level)})`).join(', ') || 'unspecified'}
      ${p.learning.length ? `<br /><b>Learning</b> ${p.learning.map(esc).join(', ')}` : ''}
    </div>
    <div class="people">${p.interests.map((i) => `<span class="person">${esc(i)}</span>`).join('')}</div>
    <p class="why">Wants: ${p.seeking.map(esc).join(', ') || 'unspecified'}.
      Energy: ${esc(p.energyStyle)}.</p>`;
  $('#detail').showModal();
}

loadMe().catch((err) => { main.innerHTML = `<div class="err">${esc(err.message)}</div>`; });
