// Environment Matrix webview script. Renders data posted by MatrixPanel and sends user actions back.
// No framework, no external requests (the Content-Security-Policy forbids them anyway).
// @ts-check
(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const saved = vscode.getState() || {};
  /** @type {any} */
  let data = null;

  const search = /** @type {HTMLInputElement} */ ($('search'));
  const onlyDiff = /** @type {HTMLInputElement} */ ($('onlyDiff'));
  const onlyStale = /** @type {HTMLInputElement} */ ($('onlyStale'));
  const showArchived = /** @type {HTMLInputElement} */ ($('showArchived'));
  const diffA = /** @type {HTMLSelectElement} */ ($('diffA'));
  const diffB = /** @type {HTMLSelectElement} */ ($('diffB'));
  search.value = saved.search || '';
  onlyDiff.checked = !!saved.onlyDiff;
  onlyStale.checked = !!saved.onlyStale;
  showArchived.checked = !!saved.showArchived;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c !== null && c !== undefined) node.append(c);
    return node;
  }

  function persist() {
    vscode.setState({ search: search.value, onlyDiff: onlyDiff.checked, onlyStale: onlyStale.checked, showArchived: showArchived.checked, diffA: diffA.value, diffB: diffB.value });
  }

  function fillSelect(select, envs, preferred) {
    const previous = select.value;
    select.replaceChildren(...envs.map((e) => el('option', { value: e.id }, e.name)));
    const want = [previous, preferred].find((v) => v && envs.some((e) => String(e.id) === String(v)));
    if (want) select.value = String(want);
  }

  function render() {
    if (!data) return;
    $('project').textContent = `${data.project} · ${data.source}`;
    const status = $('status');
    status.hidden = !data.status;
    status.textContent = data.status;

    const envs = data.envs;
    const byName = (n) => envs.find((e) => e.name.toLowerCase() === n)?.id;
    fillSelect(diffA, envs, saved.diffA || byName('staging') || envs[0]?.id);
    fillSelect(diffB, envs, saved.diffB || byName('production') || envs[envs.length - 1]?.id);

    const thead = /** @type {HTMLTableSectionElement} */ ($('matrix').querySelector('thead'));
    thead.replaceChildren(
      el(
        'tr',
        {},
        el('th', { class: 'flag' }, 'Flag'),
        ...envs.map((e) =>
          el(
            'th',
            { class: e.id === data.activeEnvId ? 'active' : '', title: [e.protected ? 'Protected: typed confirmation required' : '', e.readOnly ? 'Read-only: feature versioning (v2)' : ''].filter(Boolean).join('\n') || undefined },
            e.name,
            e.protected ? el('span', { class: 'shield' }, ' ⛨') : null,
            e.readOnly ? el('span', { class: 'ro' }, ' (read-only)') : null,
          ),
        ),
      ),
    );

    const q = search.value.trim().toLowerCase();
    const rows = data.rows.filter(
      (r) =>
        (showArchived.checked || !r.archived) &&
        (!onlyDiff.checked || r.differs) &&
        (!onlyStale.checked || r.stale) &&
        (!q || r.key.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
    );
    const tbody = /** @type {HTMLTableSectionElement} */ ($('matrix').querySelector('tbody'));
    tbody.replaceChildren(
      ...rows.map((r) =>
        el(
          'tr',
          { class: [r.differs ? 'differs' : '', r.archived ? 'archived' : '', r.key === data.focus ? 'focus' : ''].join(' ') },
          el(
            'td',
            { class: 'flag', title: r.description || undefined },
            el('a', { href: '#', onclick: (e) => (e.preventDefault(), vscode.postMessage({ type: 'open', key: r.key })) }, r.key),
            ...r.badges.map((b) => el('span', { class: `badge ${b.label}`, title: b.detail }, b.label)),
          ),
          ...envs.map((e) => {
            const c = r.cells[e.id];
            if (!c) return el('td', { class: 'cell none' }, '—');
            const title = c.blocked ? c.blocked : `Click to turn ${c.enabled ? 'OFF' : 'ON'} in ${e.name}`;
            return el(
              'td',
              { class: `cell ${c.enabled ? 'on' : 'off'} ${c.blocked ? 'blocked' : ''}` },
              el(
                'button',
                { class: 'toggle', title, disabled: !!c.blocked, onclick: () => vscode.postMessage({ type: 'toggle', key: r.key, envId: e.id }) },
                el('span', { class: 'dot' }, c.enabled ? '●' : '○'),
                c.enabled ? ' on' : ' off',
              ),
              c.value ? el('span', { class: 'value', title: 'Click to edit the value', onclick: () => !c.blocked && vscode.postMessage({ type: 'setValue', key: r.key, envId: e.id }) }, c.value) : null,
            );
          }),
        ),
      ),
    );
    $('empty').hidden = rows.length > 0;
    const focusRow = tbody.querySelector('tr.focus');
    if (focusRow) focusRow.scrollIntoView({ block: 'center' });
  }

  for (const input of [search, onlyDiff, onlyStale, showArchived]) input.addEventListener('input', () => (persist(), render()));
  for (const s of [diffA, diffB]) s.addEventListener('change', persist);
  $('copyDiff').addEventListener('click', () => vscode.postMessage({ type: 'copyDiff', a: Number(diffA.value), b: Number(diffB.value) }));
  $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'data') {
      data = event.data.data;
      render();
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
