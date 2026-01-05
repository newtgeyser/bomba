import { validateScheme } from '../shared/scheme/validate.js';
import { ItemType, Team, TileType } from '../shared/scheme/schema.js';
import { OFFICIAL_SCHEMES } from '../shared/scheme/library.js';
import { button, el } from './dom.js';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function saveDrafts(drafts) {
  localStorage.setItem('aboDrafts', JSON.stringify(drafts));
}

function loadDrafts() {
  try {
    return JSON.parse(localStorage.getItem('aboDrafts') ?? '[]');
  } catch {
    return [];
  }
}

export function createEditorView({ state, initial, onBack }) {
  const readOnly = initial?.meta?.visibility === 'Official' || initial?.readOnly;
  const editor = {
    scheme: initial?.scheme ? clone(initial.scheme) : clone(OFFICIAL_SCHEMES[0]),
    meta: initial?.meta ?? null,
    editToken: initial?.editToken ?? null,
    selectedTile: TileType.Floor,
    tool: 'paint', // paint | spawn
    selectedSpawnIndex: 0,
    errors: [],
    warnings: [],
  };

  const title = el('h2', { text: `Map Editor${readOnly ? ' (read-only)' : ''}` });
  const status = el('div', { class: 'muted', text: '' });

  const canvas = el('canvas', { width: 900, height: 660 });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Missing 2d context');

  function tileKey(x, y) {
    return y * editor.scheme.width + x;
  }

  function validate() {
    editor.errors = [];
    editor.warnings = [];
    try {
      validateScheme(editor.scheme);
    } catch (e) {
      editor.errors.push(e?.message ?? String(e));
    }
    // Warn if spawns are heavily boxed by hard blocks.
    for (const s of editor.scheme.spawns) {
      const adj = [
        [s.x + 1, s.y],
        [s.x - 1, s.y],
        [s.x, s.y + 1],
        [s.x, s.y - 1],
      ];
      let hard = 0;
      for (const [x, y] of adj) {
        const t = editor.scheme.tiles[tileKey(x, y)];
        if (t === TileType.Hard) hard++;
      }
      if (hard >= 3) editor.warnings.push(`Spawn ${s.spawnIndex} may be boxed in (adjacent hard blocks: ${hard}).`);
    }
    status.textContent =
      editor.errors.length > 0
        ? `Errors: ${editor.errors[0]}`
        : editor.warnings.length > 0
          ? `Warning: ${editor.warnings[0]}`
          : 'OK';
  }

  function draw() {
    const s = editor.scheme;
    const tileW = canvas.width / s.width;
    const tileH = canvas.height / s.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const t = s.tiles[tileKey(x, y)];
        ctx.fillStyle = t === TileType.Hard ? '#2b3555' : t === TileType.Soft ? '#3b2f2a' : '#0d1426';
        ctx.fillRect(x * tileW, y * tileH, tileW, tileH);
      }
    }
    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= s.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * tileW, 0);
      ctx.lineTo(x * tileW, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= s.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * tileH);
      ctx.lineTo(canvas.width, y * tileH);
      ctx.stroke();
    }

    // Spawns
    for (const sp of s.spawns) {
      const cx = (sp.x + 0.5) * tileW;
      const cy = (sp.y + 0.5) * tileH;
      ctx.fillStyle = sp.spawnIndex === editor.selectedSpawnIndex ? 'rgba(255,215,0,0.9)' : 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(tileW, tileH) * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0e14';
      ctx.font = '12px ui-sans-serif';
      ctx.fillText(String(sp.spawnIndex), cx - 4, cy + 4);
    }
  }

  function canvasToTile(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    const tx = Math.floor((x / canvas.width) * editor.scheme.width);
    const ty = Math.floor((y / canvas.height) * editor.scheme.height);
    return [Math.max(0, Math.min(editor.scheme.width - 1, tx)), Math.max(0, Math.min(editor.scheme.height - 1, ty))];
  }

  function setTile(tx, ty, type) {
    if (readOnly) return;
    const idx = tileKey(tx, ty);
    editor.scheme.tiles[idx] = type;
    // Ensure no spawn is on non-floor.
    for (const sp of editor.scheme.spawns) {
      if (sp.x === tx && sp.y === ty && type !== TileType.Floor) {
        editor.scheme.tiles[idx] = TileType.Floor;
      }
    }
  }

  let dragging = false;
  canvas.addEventListener('mousedown', (ev) => {
    dragging = true;
    const [tx, ty] = canvasToTile(ev);
    if (editor.tool === 'paint') setTile(tx, ty, editor.selectedTile);
    if (editor.tool === 'spawn' && !readOnly) {
      const sp = editor.scheme.spawns.find((s) => s.spawnIndex === editor.selectedSpawnIndex);
      if (sp) {
        sp.x = tx;
        sp.y = ty;
        editor.scheme.tiles[tileKey(tx, ty)] = TileType.Floor;
      }
    }
    validate();
    draw();
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!dragging) return;
    const [tx, ty] = canvasToTile(ev);
    if (editor.tool === 'paint') {
      setTile(tx, ty, editor.selectedTile);
      validate();
      draw();
    }
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  const tileSelect = el(
    'select',
    {
      onchange: (e) => {
        editor.selectedTile = e.target.value;
        editor.tool = 'paint';
      },
      disabled: readOnly,
    },
    [TileType.Floor, TileType.Soft, TileType.Hard].map((t) => el('option', { value: t, text: `Paint: ${t}` })),
  );

  const spawnSelect = el(
    'select',
    {
      onchange: (e) => {
        editor.selectedSpawnIndex = Number(e.target.value);
        editor.tool = 'spawn';
        draw();
      },
      disabled: readOnly,
    },
    Array.from({ length: 10 }, (_, i) => el('option', { value: String(i), text: `Move Spawn ${i}` })),
  );

  const nameInput = el('input', {
    value: editor.scheme.name,
    disabled: readOnly,
    oninput: (e) => {
      editor.scheme.name = e.target.value.slice(0, 40);
    },
  });

  const density = el('input', {
    type: 'number',
    min: '0',
    max: '100',
    step: '1',
    value: String(editor.scheme.itemRules.densityPercent),
    disabled: readOnly,
    oninput: (e) => {
      editor.scheme.itemRules.densityPercent = Math.max(0, Math.min(100, Number(e.target.value)));
      validate();
    },
  });

  const spawnTeams = el(
    'div',
    { class: 'list' },
    editor.scheme.spawns.map((sp) => {
      const teamSel = el(
        'select',
        {
          disabled: readOnly,
          onchange: (e) => {
            sp.team = e.target.value;
            validate();
          },
        },
        Object.values(Team).map((t) => el('option', { value: t, text: t })),
      );
      teamSel.value = sp.team;
      return el('div', { class: 'item' }, [el('div', { text: `Spawn ${sp.spawnIndex}` }), teamSel]);
    }),
  );

  const itemRows = Object.values(ItemType).map((it) => {
    const rule = editor.scheme.itemRules.items[it];
    const bornWith = el('input', {
      type: 'number',
      min: '0',
      max: '10',
      step: '1',
      value: String(rule.bornWith),
      disabled: readOnly,
      oninput: (e) => {
        rule.bornWith = Math.max(0, Math.min(10, Number(e.target.value)));
        validate();
      },
    });
    const forbid = el('input', {
      type: 'checkbox',
      checked: !!rule.forbidInRandom,
      disabled: readOnly,
      onchange: (e) => {
        rule.forbidInRandom = !!e.target.checked;
        validate();
      },
    });
    const mode = el(
      'select',
      {
        disabled: readOnly,
        onchange: (e) => {
          rule.override.mode = e.target.value;
          validate();
        },
      },
      ['Default', 'FixedCount', 'ChanceIn10'].map((m) => el('option', { value: m, text: m })),
    );
    mode.value = rule.override.mode;
    const val = el('input', {
      type: 'number',
      min: '0',
      max: '100',
      step: '1',
      value: String(rule.override.value),
      disabled: readOnly,
      oninput: (e) => {
        rule.override.value = Math.max(0, Number(e.target.value));
        validate();
      },
    });

    return el('div', { class: 'item' }, [
      el('div', {}, [el('div', { text: it }), el('div', { class: 'muted', text: 'BornWith / ForbidInRandom / Override' })]),
      el('div', { class: 'row' }, [bornWith, forbid, mode, val]),
    ]);
  });
  const itemList = el('div', { class: 'list' }, itemRows);

  const drafts = loadDrafts();
  const draftSelect = el(
    'select',
    { disabled: drafts.length === 0 },
    drafts.map((d, i) => el('option', { value: String(i), text: `${d.name} (${new Date(d.savedAt).toLocaleString()})` })),
  );

  async function publish() {
    if (readOnly) return;
    validate();
    if (editor.errors.length) {
      alert(`Fix errors first:\n${editor.errors.join('\n')}`);
      return;
    }
    const visibility = prompt('Visibility: Community or Unlisted', 'Community') === 'Unlisted' ? 'Unlisted' : 'Community';
    const res = await fetch('/api/schemes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scheme: editor.scheme,
        visibility,
        author: state.name || 'Guest',
        id: editor.scheme.id?.startsWith('m_') ? editor.scheme.id : undefined,
        editToken: editor.editToken ?? undefined,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      alert(`Publish failed: ${json.error}`);
      return;
    }
    editor.scheme = clone(json.scheme);
    editor.editToken = json.editToken;
    editor.meta = json.meta;
    alert(`Published as ${json.id}. Share link copied.`);
    await navigator.clipboard?.writeText(`${location.origin}/#map=${encodeURIComponent(json.id)}`);
    validate();
    draw();
  }

  validate();
  draw();

  return el('div', { class: 'grid2' }, [
    el('div', { class: 'panel' }, [
      title,
      status,
      canvas,
      el('div', { class: 'row' }, [tileSelect, spawnSelect]),
    ]),
    el('div', { class: 'panel' }, [
      el('h3', { text: 'Details' }),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Name' }), nameInput]),
      el('div', { class: 'row' }, [el('label', { class: 'muted', text: 'Item density %' }), density]),
      el('h3', { text: 'Spawns' }),
      spawnTeams,
      el('h3', { text: 'Item rules' }),
      itemList,
      el('h3', { text: 'Drafts + Publish' }),
      el('div', { class: 'row' }, [
        button('Save Draft', () => {
          if (readOnly) return;
          const list = loadDrafts();
          list.unshift({ name: editor.scheme.name, savedAt: Date.now(), scheme: editor.scheme, editToken: editor.editToken });
          saveDrafts(list.slice(0, 20));
          alert('Saved draft.');
        }),
        button('Load Draft', () => {
          const list = loadDrafts();
          const idx = Number(draftSelect.value);
          const d = list[idx];
          if (!d) return;
          editor.scheme = clone(d.scheme);
          editor.editToken = d.editToken ?? null;
          validate();
          draw();
        }),
        draftSelect,
      ]),
      el('div', { class: 'row' }, [
        button('Publish', () => publish(), { primary: true }),
        button('Back', () => onBack?.()),
      ]),
    ]),
  ]);
}
