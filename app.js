/* =============================================================
   SkillOS — Application Core
   Architecture (top-down):
     1. State & constants
     2. Storage (load / save / migrate)
     3. Tree helpers (find / walk / stats / mutate)
     4. Renderer (DOM construction + diff)
     5. Progress engine (anime.js)
     6. Search engine
     7. Drawer (notes editor)
     8. Drag-and-drop
     9. Roadmap manager (create/duplicate/delete/import/export)
    10. Theme & shortcuts
    11. Boot
   ============================================================= */

(() => {
  'use strict';

  /* ---------------- 1. State ---------------- */
  const STORAGE_KEY  = 'skillos.v1';
  const THEME_KEY    = 'skillos.theme';
  const STREAK_KEY   = 'skillos.streak';

  /** @type {{ roadmaps: Roadmap[], currentId: string }} */
  let state = {
    roadmaps: [],
    currentId: null,
  };

  let searchQuery   = '';
  let activeNodeId  = null;          // node currently open in the drawer
  let saveTimer     = null;
  let dragState     = null;          // { nodeId, src }

  /* ---------------- 2. Storage ---------------- */

  /** Generate a stable unique id. */
  const uid = () => 'n_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

  /** Persist state with debounce + update "last saved" label. */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        const el = document.getElementById('lastSaved');
        if (el) el.textContent = 'saved ' + formatTime(new Date());
      } catch (e) {
        console.error('save failed', e);
        toast('Save failed — storage may be full');
      }
    }, 250);
  }

  function formatTime(d) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /** Load state from storage, or seed from sample data. */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.roadmaps) && parsed.roadmaps.length) {
          state = parsed;
          // ensure currentId is valid
          if (!state.roadmaps.find(r => r.id === state.currentId)) {
            state.currentId = state.roadmaps[0].id;
          }
          return;
        }
      }
    } catch (e) {
      console.warn('load failed, reseeding', e);
    }

    // Seed
    const seed = JSON.parse(JSON.stringify(window.SAMPLE_ROADMAPS));
    state.roadmaps = seed;
    state.currentId = seed[0].id;
  }

  /* ---------------- 3. Tree helpers ---------------- */

  function currentRoadmap() {
    return state.roadmaps.find(r => r.id === state.currentId);
  }

  /** Walk: visit every node (excluding the roadmap root). */
  function walk(nodes, fn, parent = null, depth = 0) {
    for (const n of nodes) {
      fn(n, parent, depth);
      if (n.children && n.children.length) walk(n.children, fn, n, depth + 1);
    }
  }

  /** Find node + parent array by id. */
  function findNode(nodes, id, parentArr = null) {
    for (const n of nodes) {
      if (n.id === id) return { node: n, parent: parentArr || nodes };
      if (n.children) {
        const found = findNode(n.children, id, n.children);
        if (found) return found;
      }
    }
    return null;
  }

  /** Returns true if a descendant of `ancestor` has id === id. */
  function isDescendant(ancestor, id) {
    if (!ancestor.children) return false;
    for (const c of ancestor.children) {
      if (c.id === id) return true;
      if (isDescendant(c, id)) return true;
    }
    return false;
  }

  /** Compute completion stats. Returns { done, total, pct, leafDone, leafTotal }. */
  function stats(nodes) {
    let leafDone = 0, leafTotal = 0, done = 0, total = 0;
    walk(nodes, (n) => {
      total++;
      if (!n.children || n.children.length === 0) {
        leafTotal++;
        if (n.done) leafDone++;
      }
      if (effectiveDone(n)) done++;
    });
    const pct = leafTotal === 0 ? 0 : Math.round((leafDone / leafTotal) * 100);
    return { done, total, pct, leafDone, leafTotal };
  }

  /** A node is considered "done" if leaf-and-done, or all leaf descendants done. */
  function effectiveDone(n) {
    if (!n.children || n.children.length === 0) return !!n.done;
    return childPct(n) === 100;
  }

  /** Completion percentage of a node's subtree, based on leaf descendants. */
  function childPct(n) {
    let d = 0, t = 0;
    walk([n], (x) => {
      if (!x.children || x.children.length === 0) {
        t++;
        if (x.done) d++;
      }
    });
    if (t === 0) return n.done ? 100 : 0;
    return Math.round((d / t) * 100);
  }

  /** Recursively assign new ids — used on import/duplicate to guarantee uniqueness. */
  function reassignIds(nodes) {
    for (const n of nodes) {
      n.id = uid();
      if (n.children) reassignIds(n.children);
    }
  }

  /** Toggle done with propagation: parent done ⇒ check all leaves; uncheck ⇒ uncheck all leaves. */
  function toggleDone(node) {
    const target = !effectiveDone(node);
    walk([node], (n) => {
      if (!n.children || n.children.length === 0) n.done = target;
    });
    // For leaf with no children, also set node.done
    if (!node.children || node.children.length === 0) node.done = target;
    bumpStreak();
  }

  /* ---------------- Streak ---------------- */
  function bumpStreak() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let s;
    try {
      s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null');
    } catch (e) { s = null; }

    if (!s) {
      s = { last: today, streak: 1, lastBumpToday: true };
    } else if (s.last === today) {
      s.streak = Math.max(1, s.streak || 1);
    } else {
      const diff = daysBetween(s.last, today);
      if (diff === 1) s.streak = (s.streak || 0) + 1;
      else s.streak = 1; // reset
      s.last = today;
    }
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  }

  function readStreak() {
    let s;
    try { s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null'); }
    catch (e) { return { streak: 0, hint: 'start your first day' }; }
    if (!s) return { streak: 0, hint: 'start your first day' };
    const today = new Date().toISOString().slice(0, 10);
    if (s.last === today) return { streak: s.streak, hint: 'active today' };
    if (daysBetween(s.last, today) === 1) return { streak: s.streak, hint: 'check in today' };
    return { streak: 0, hint: 'streak reset' };
  }

  function daysBetween(a, b) {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  /* ---------------- 4. Renderer ---------------- */

  const $tree     = document.getElementById('tree');
  const $empty    = document.getElementById('emptyState');

  /** Render the entire current roadmap. */
  function render() {
    const rm = currentRoadmap();
    if (!rm) return;

    // Hero
    document.getElementById('heroTitle').textContent = rm.name;
    document.getElementById('heroSubtitle').textContent = rm.description || '';
    document.getElementById('currentRoadmapName').textContent = rm.name;

    // Dashboard
    renderDashboard(rm);

    // Tree
    $tree.innerHTML = '';
    if (!rm.children || rm.children.length === 0) {
      $empty.classList.remove('hidden');
    } else {
      $empty.classList.add('hidden');
      const frag = document.createDocumentFragment();
      for (const n of rm.children) {
        frag.appendChild(renderNode(n, 0));
      }
      $tree.appendChild(frag);
    }

    // Re-apply search filter if any
    if (searchQuery) applySearch(searchQuery);
  }

  /** Render a single tree node + its subtree. Recursive. */
  function renderNode(node, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node';
    wrap.dataset.id = node.id;
    wrap.draggable = true;

    /* ----- Row ----- */
    const row = document.createElement('div');
    row.className = 'node-row';
    if (effectiveDone(node)) row.classList.add('is-done');

    // Caret
    const caret = document.createElement('button');
    caret.className = 'caret';
    caret.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    const hasKids = node.children && node.children.length > 0;
    if (!hasKids) caret.classList.add('is-empty');
    if (node.expanded && hasKids) caret.classList.add('is-open');
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpand(node, wrap);
    });

    // Drag handle (subtle, only visible on hover)
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" class="w-3 h-3"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;

    // Checkbox
    const cb = document.createElement('button');
    cb.className = 'checkbox';
    const pct = childPct(node);
    if (pct === 100) cb.classList.add('is-checked');
    else if (pct > 0) cb.classList.add('is-partial');
    cb.innerHTML = `
      <svg class="check-icon w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <svg class="partial-icon w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
    `;
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDone(node);
      // animate the checkbox
      anime({
        targets: cb,
        scale: [1, 0.85, 1],
        duration: 280,
        easing: 'easeOutQuad',
      });
      updateAncestorVisuals(wrap);
      renderDashboard(currentRoadmap(), true);
      save();
    });

    // Label
    const label = document.createElement('div');
    label.className = 'node-label';
    const text = document.createElement('span');
    text.className = 'label-text';
    text.textContent = node.title;
    label.appendChild(text);

    // Notes indicator
    if ((node.notes && node.notes.trim()) || (node.resources && node.resources.length)) {
      const dot = document.createElement('span');
      dot.className = 'has-notes-dot';
      dot.title = 'Has notes/resources';
      label.appendChild(dot);
    }

    // Mini progress on branch nodes only
    if (hasKids) {
      const mini = document.createElement('span');
      mini.className = 'mini-progress';
      mini.innerHTML = `
        <span class="mini-progress-bar"><span style="width:${pct}%"></span></span>
        <span class="mini-pct">${pct}%</span>
      `;
      label.appendChild(mini);
    }

    // Click on label → open drawer
    label.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      openDrawer(node);
    });

    // Double click on text → inline rename
    text.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      inlineRename(node, text, row);
    });

    // Actions: add child, add sibling, delete
    const actions = document.createElement('div');
    actions.className = 'node-actions';
    actions.innerHTML = `
      <button data-act="add-child" title="Add subtask">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
      </button>
      <button data-act="open" title="Open notes">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
      </button>
      <button data-act="delete" title="Delete">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>
      </button>
    `;
    actions.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'add-child') {
        addChild(node);
      } else if (act === 'open') {
        openDrawer(node);
      } else if (act === 'delete') {
        confirmDelete(node);
      }
    });

    // Assemble
    row.appendChild(caret);
    row.appendChild(handle);
    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(actions);
    wrap.appendChild(row);

    // Children container
    if (hasKids) {
      const kidsWrap = document.createElement('div');
      kidsWrap.className = 'tree-children';
      if (!node.expanded) kidsWrap.style.display = 'none';
      for (const c of node.children) {
        kidsWrap.appendChild(renderNode(c, depth + 1));
      }
      wrap.appendChild(kidsWrap);
    }

    // Drag handlers
    attachDrag(wrap, node);

    return wrap;
  }

  /** Smoothly expand/collapse using anime.js (height animation). */
  function toggleExpand(node, wrap) {
    node.expanded = !node.expanded;
    save();

    const caret = wrap.querySelector(':scope > .node-row > .caret');
    let kids = wrap.querySelector(':scope > .tree-children');

    // If first-time expansion and children not yet rendered, render them now.
    if (!kids && node.children && node.children.length) {
      kids = document.createElement('div');
      kids.className = 'tree-children';
      for (const c of node.children) kids.appendChild(renderNode(c, 0));
      wrap.appendChild(kids);
      kids.style.display = 'none';
    }
    if (!kids) return;

    if (node.expanded) {
      caret.classList.add('is-open');
      kids.style.display = '';
      kids.style.height = '0px';
      kids.style.opacity = '0';
      const targetH = kids.scrollHeight;
      anime.remove(kids);
      anime({
        targets: kids,
        height: [0, targetH],
        opacity: [0, 1],
        duration: 260,
        easing: 'easeOutExpo',
        complete: () => {
          kids.style.height = '';
          kids.style.opacity = '';
        },
      });
    } else {
      caret.classList.remove('is-open');
      const startH = kids.scrollHeight;
      kids.style.height = startH + 'px';
      kids.style.opacity = '1';
      anime.remove(kids);
      anime({
        targets: kids,
        height: 0,
        opacity: 0,
        duration: 220,
        easing: 'easeInOutQuad',
        complete: () => {
          kids.style.display = 'none';
          kids.style.height = '';
          kids.style.opacity = '';
        },
      });
    }
  }

  /** Re-derive parent visuals after a child's done state changes. */
  function updateAncestorVisuals(startWrap) {
    let cursor = startWrap;
    while (cursor) {
      const id = cursor.dataset.id;
      if (!id) break;
      const ref = findNode(currentRoadmap().children, id);
      if (!ref) break;
      const row = cursor.querySelector(':scope > .node-row');
      const cb  = row.querySelector('.checkbox');
      const pct = childPct(ref.node);
      cb.classList.remove('is-checked', 'is-partial');
      if (pct === 100) cb.classList.add('is-checked');
      else if (pct > 0) cb.classList.add('is-partial');

      // strike-through state
      if (effectiveDone(ref.node)) row.classList.add('is-done');
      else row.classList.remove('is-done');

      // mini progress
      const mini = row.querySelector('.mini-progress');
      if (mini) {
        const bar = mini.querySelector('.mini-progress-bar > span');
        const txt = mini.querySelector('.mini-pct');
        if (bar) {
          anime.remove(bar);
          anime({ targets: bar, width: pct + '%', duration: 500, easing: 'easeOutExpo' });
        }
        if (txt) txt.textContent = pct + '%';
      }

      // Move up the tree
      const parent = cursor.parentElement; // .tree-children
      cursor = parent ? parent.closest('.tree-node') : null;
    }
  }

  /* ---------------- 5. Dashboard / progress engine ---------------- */

  function renderDashboard(rm, animate = false) {
    const s = stats(rm.children);
    const streak = readStreak();

    const overallPctEl  = document.getElementById('overallPct');
    const overallLarge  = document.getElementById('overallPctLarge');
    const overallBar    = document.getElementById('overallBar');
    const completedEl   = document.getElementById('statCompleted');
    const totalEl       = document.getElementById('statTotal');
    const streakEl      = document.getElementById('statStreak');
    const streakHint    = document.getElementById('statStreakHint');
    const remainingHint = document.getElementById('statRemainingHint');

    overallPctEl.textContent = s.pct + '%';
    overallLarge.innerHTML = `${s.pct}<span class="text-ink-300 dark:text-ink-600">%</span>`;

    if (animate) {
      anime.remove(overallBar);
      anime({ targets: overallBar, width: s.pct + '%', duration: 800, easing: 'easeOutExpo' });
      animateNumber(completedEl, s.leafDone);
    } else {
      overallBar.style.width = s.pct + '%';
      completedEl.textContent = s.leafDone;
    }

    totalEl.textContent = s.leafTotal;
    remainingHint.textContent = (s.leafTotal - s.leafDone) + ' remaining';
    streakEl.textContent = streak.streak;
    streakHint.textContent = streak.hint;
  }

  /** Smoothly animate a number element from current → target. */
  function animateNumber(el, target) {
    const start = parseInt(el.textContent, 10) || 0;
    if (start === target) { el.textContent = target; return; }
    const obj = { v: start };
    anime({
      targets: obj,
      v: target,
      duration: 600,
      easing: 'easeOutExpo',
      round: 1,
      update: () => { el.textContent = obj.v; },
    });
  }

  /* ---------------- 6. Search ---------------- */

  const $searchInput = document.getElementById('searchInput');
  const $filterBadge = document.getElementById('filterBadge');
  const $filterBadgeText = document.getElementById('filterBadgeText');

  $searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    applySearch(searchQuery);
  });

  document.getElementById('clearFilterBtn').addEventListener('click', () => {
    searchQuery = '';
    $searchInput.value = '';
    applySearch('');
  });

  /** Filter the visible tree by query. Highlights matches & auto-expands branches. */
  function applySearch(q) {
    const all = $tree.querySelectorAll('.tree-node');
    // reset
    all.forEach(el => {
      el.classList.remove('is-hidden-by-search', 'is-search-match');
      const t = el.querySelector(':scope > .node-row .label-text');
      if (t && t.dataset.origText) {
        t.innerHTML = '';
        t.textContent = t.dataset.origText;
        delete t.dataset.origText;
      }
    });

    if (!q) {
      $filterBadge.classList.add('hidden');
      $filterBadge.classList.remove('inline-flex');
      // restore original expansion state
      restoreExpansion($tree, currentRoadmap().children);
      return;
    }

    const lowerQ = q.toLowerCase();
    let matchCount = 0;

    // 1) Mark matches & their ancestors as visible; others hidden
    const visible = new Set();
    function visit(nodes, ancestorsStack) {
      for (const n of nodes) {
        const isMatch = n.title.toLowerCase().includes(lowerQ);
        if (isMatch) {
          matchCount++;
          visible.add(n.id);
          for (const a of ancestorsStack) visible.add(a.id);
        }
        if (n.children && n.children.length) {
          ancestorsStack.push(n);
          visit(n.children, ancestorsStack);
          ancestorsStack.pop();
        }
      }
    }
    visit(currentRoadmap().children, []);

    // 2) Apply DOM updates
    all.forEach(el => {
      const id = el.dataset.id;
      const ref = findNode(currentRoadmap().children, id);
      if (!ref) return;
      if (!visible.has(id)) {
        el.classList.add('is-hidden-by-search');
        return;
      }
      const isMatch = ref.node.title.toLowerCase().includes(lowerQ);
      if (isMatch) {
        el.classList.add('is-search-match');
        // highlight in label
        const t = el.querySelector(':scope > .node-row .label-text');
        if (t) {
          t.dataset.origText = ref.node.title;
          t.innerHTML = highlight(ref.node.title, q);
        }
      }
      // ensure expanded so children are visible
      const kids = el.querySelector(':scope > .tree-children');
      if (kids) {
        kids.style.display = '';
        kids.style.height = '';
        const caret = el.querySelector(':scope > .node-row > .caret');
        if (caret) caret.classList.add('is-open');
      }
    });

    $filterBadge.classList.remove('hidden');
    $filterBadge.classList.add('inline-flex');
    $filterBadgeText.textContent = `${matchCount} match${matchCount === 1 ? '' : 'es'}`;
  }

  function highlight(text, q) {
    const safe = text.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<span class="search-highlight">$1</span>');
  }

  /** Restore expansion to match data model after clearing a search. */
  function restoreExpansion(container, dataNodes) {
    const wraps = container.querySelectorAll(':scope > .tree-node');
    wraps.forEach(w => {
      const id = w.dataset.id;
      const data = dataNodes.find(d => d.id === id);
      if (!data) return;
      const kids = w.querySelector(':scope > .tree-children');
      const caret = w.querySelector(':scope > .node-row > .caret');
      if (kids) {
        if (data.expanded) {
          kids.style.display = '';
          if (caret) caret.classList.add('is-open');
        } else {
          kids.style.display = 'none';
          if (caret) caret.classList.remove('is-open');
        }
        if (data.children && data.children.length) restoreExpansion(kids, data.children);
      }
    });
  }

  /* ---------------- 7. Drawer ---------------- */

  const $drawer     = document.getElementById('drawer');
  const $backdrop   = document.getElementById('drawerBackdrop');
  const $drawerTitle = document.getElementById('drawerTitle');
  const $drawerTitleInput = document.getElementById('drawerTitleInput');
  const $drawerNotes = document.getElementById('drawerNotes');
  const $drawerCheckbox = document.getElementById('drawerCheckbox');
  const $drawerStatusText = document.getElementById('drawerStatusText');
  const $resourceList = document.getElementById('resourceList');

  $drawerCheckbox.innerHTML = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  function openDrawer(node) {
    activeNodeId = node.id;
    $drawerTitle.textContent = node.title || 'Untitled';
    $drawerTitleInput.value = node.title || '';
    $drawerNotes.value = node.notes || '';
    refreshDrawerStatus(node);
    renderResources(node);

    $drawer.classList.add('is-open');
    $backdrop.classList.add('is-open');
  }

  function closeDrawer() {
    $drawer.classList.remove('is-open');
    $backdrop.classList.remove('is-open');
    activeNodeId = null;
  }

  function refreshDrawerStatus(node) {
    const pct = childPct(node);
    if (pct === 100) {
      $drawerCheckbox.classList.add('is-checked');
      $drawerStatusText.textContent = 'Completed';
    } else if (pct > 0) {
      $drawerCheckbox.classList.remove('is-checked');
      $drawerStatusText.textContent = `In progress · ${pct}%`;
    } else {
      $drawerCheckbox.classList.remove('is-checked');
      $drawerStatusText.textContent = 'Pending';
    }
  }

  $drawerCheckbox.addEventListener('click', () => {
    if (!activeNodeId) return;
    const ref = findNode(currentRoadmap().children, activeNodeId);
    if (!ref) return;
    toggleDone(ref.node);
    const wrap = $tree.querySelector(`[data-id="${activeNodeId}"]`);
    if (wrap) updateAncestorVisuals(wrap);
    refreshDrawerStatus(ref.node);
    renderDashboard(currentRoadmap(), true);
    save();
  });

  $drawerTitleInput.addEventListener('input', (e) => {
    if (!activeNodeId) return;
    const ref = findNode(currentRoadmap().children, activeNodeId);
    if (!ref) return;
    ref.node.title = e.target.value;
    $drawerTitle.textContent = e.target.value || 'Untitled';
    // update label in tree
    const wrap = $tree.querySelector(`[data-id="${activeNodeId}"]`);
    if (wrap) {
      const lbl = wrap.querySelector(':scope > .node-row .label-text');
      if (lbl) lbl.textContent = e.target.value;
    }
    save();
  });

  $drawerNotes.addEventListener('input', (e) => {
    if (!activeNodeId) return;
    const ref = findNode(currentRoadmap().children, activeNodeId);
    if (!ref) return;
    ref.node.notes = e.target.value;
    save();
    // refresh notes indicator dot
    const wrap = $tree.querySelector(`[data-id="${activeNodeId}"]`);
    if (wrap) refreshNotesDot(wrap, ref.node);
  });

  function refreshNotesDot(wrap, node) {
    const lbl = wrap.querySelector(':scope > .node-row .node-label');
    if (!lbl) return;
    let dot = lbl.querySelector('.has-notes-dot');
    const has = (node.notes && node.notes.trim()) || (node.resources && node.resources.length);
    if (has && !dot) {
      dot = document.createElement('span');
      dot.className = 'has-notes-dot';
      // insert before mini-progress if present, else append
      const mini = lbl.querySelector('.mini-progress');
      if (mini) lbl.insertBefore(dot, mini);
      else lbl.appendChild(dot);
    } else if (!has && dot) {
      dot.remove();
    }
  }

  function renderResources(node) {
    $resourceList.innerHTML = '';
    (node.resources || []).forEach((r, idx) => {
      const item = document.createElement('div');
      item.className = 'resource-item';
      item.innerHTML = `
        <svg class="w-3.5 h-3.5 text-ink-400 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
        <input type="text" data-field="label" data-idx="${idx}" value="${escapeAttr(r.label || '')}" placeholder="Label" />
        <input type="text" data-field="url" data-idx="${idx}" value="${escapeAttr(r.url || '')}" placeholder="https://…" />
        <button data-act="remove" data-idx="${idx}" title="Remove">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      `;
      $resourceList.appendChild(item);
    });

    $resourceList.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const i = parseInt(e.target.dataset.idx, 10);
        const f = e.target.dataset.field;
        const ref = findNode(currentRoadmap().children, activeNodeId);
        if (!ref) return;
        ref.node.resources[i][f] = e.target.value;
        save();
        const wrap = $tree.querySelector(`[data-id="${activeNodeId}"]`);
        if (wrap) refreshNotesDot(wrap, ref.node);
      });
    });
    $resourceList.querySelectorAll('button[data-act="remove"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const i = parseInt(e.currentTarget.dataset.idx, 10);
        const ref = findNode(currentRoadmap().children, activeNodeId);
        if (!ref) return;
        ref.node.resources.splice(i, 1);
        renderResources(ref.node);
        save();
        const wrap = $tree.querySelector(`[data-id="${activeNodeId}"]`);
        if (wrap) refreshNotesDot(wrap, ref.node);
      });
    });
  }

  document.getElementById('addResourceBtn').addEventListener('click', () => {
    if (!activeNodeId) return;
    const ref = findNode(currentRoadmap().children, activeNodeId);
    if (!ref) return;
    ref.node.resources = ref.node.resources || [];
    ref.node.resources.push({ label: '', url: '' });
    renderResources(ref.node);
    save();
    // focus newest input
    const last = $resourceList.querySelector('.resource-item:last-child input[data-field="label"]');
    if (last) last.focus();
  });

  document.getElementById('deleteTaskBtn').addEventListener('click', () => {
    if (!activeNodeId) return;
    const ref = findNode(currentRoadmap().children, activeNodeId);
    if (!ref) return;
    confirmDelete(ref.node, () => closeDrawer());
  });

  document.getElementById('drawerClose').addEventListener('click', closeDrawer);
  $backdrop.addEventListener('click', closeDrawer);

  /* ---------------- Tree mutations ---------------- */

  function addChild(parentNode) {
    parentNode.children = parentNode.children || [];
    const child = { id: uid(), title: 'New task', done: false, notes: '', resources: [], children: [], expanded: false };
    parentNode.children.push(child);
    parentNode.expanded = true;
    save();
    render();
    // auto-focus inline rename
    requestAnimationFrame(() => {
      const wrap = $tree.querySelector(`[data-id="${child.id}"]`);
      if (wrap) {
        wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const text = wrap.querySelector('.label-text');
        const row = wrap.querySelector('.node-row');
        if (text) inlineRename(child, text, row);
      }
    });
  }

  function addRoot() {
    const rm = currentRoadmap();
    rm.children = rm.children || [];
    const n = { id: uid(), title: 'New section', done: false, notes: '', resources: [], children: [], expanded: true };
    rm.children.push(n);
    save();
    render();
    requestAnimationFrame(() => {
      const wrap = $tree.querySelector(`[data-id="${n.id}"]`);
      if (wrap) {
        wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const text = wrap.querySelector('.label-text');
        const row = wrap.querySelector('.node-row');
        if (text) inlineRename(n, text, row);
      }
    });
  }

  function deleteNode(node) {
    const ref = findNode(currentRoadmap().children, node.id);
    if (!ref) return;
    const idx = ref.parent.indexOf(ref.node);
    if (idx >= 0) ref.parent.splice(idx, 1);
    save();
    render();
  }

  function confirmDelete(node, after) {
    showModal({
      title: 'Delete task',
      desc: `Delete "${node.title}" and all subtasks? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
      onConfirm: () => {
        deleteNode(node);
        if (after) after();
        toast('Task deleted');
      },
    });
  }

  /** Inline rename via contenteditable. */
  function inlineRename(node, textEl, rowEl) {
    const label = textEl.parentElement;
    label.setAttribute('contenteditable', 'false'); // we'll edit textEl only
    textEl.setAttribute('contenteditable', 'true');
    textEl.focus();
    // select all
    const r = document.createRange();
    r.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);

    const finish = (commit) => {
      textEl.removeAttribute('contenteditable');
      const v = textEl.textContent.trim();
      if (commit && v) {
        node.title = v;
        if (activeNodeId === node.id) {
          $drawerTitle.textContent = v;
          $drawerTitleInput.value = v;
        }
        save();
      } else {
        textEl.textContent = node.title;
      }
      textEl.removeEventListener('keydown', onKey);
      textEl.removeEventListener('blur', onBlur);
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    textEl.addEventListener('keydown', onKey);
    textEl.addEventListener('blur', onBlur);
  }

  /* ---------------- 8. Drag & drop ---------------- */

  function attachDrag(wrap, node) {
    wrap.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      dragState = { nodeId: node.id };
      wrap.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox needs data set
      try { e.dataTransfer.setData('text/plain', node.id); } catch (err) {}
    });

    wrap.addEventListener('dragend', (e) => {
      e.stopPropagation();
      wrap.classList.remove('is-dragging');
      clearDropIndicators();
      dragState = null;
    });

    wrap.addEventListener('dragover', (e) => {
      if (!dragState || dragState.nodeId === node.id) return;

      // Forbid dropping into own descendant
      const srcRef = findNode(currentRoadmap().children, dragState.nodeId);
      if (!srcRef) return;
      if (isDescendant(srcRef.node, node.id)) return;

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      const rect = wrap.getBoundingClientRect();
      const row = wrap.querySelector(':scope > .node-row');
      const rowRect = row.getBoundingClientRect();
      const y = e.clientY - rowRect.top;
      const h = rowRect.height;

      clearDropIndicators();
      if (y < h * 0.25) {
        wrap.classList.add('drop-indicator-before');
        dragState.zone = 'before';
      } else if (y > h * 0.75) {
        wrap.classList.add('drop-indicator-after');
        dragState.zone = 'after';
      } else {
        wrap.classList.add('drop-indicator-inside');
        dragState.zone = 'inside';
      }
      dragState.targetId = node.id;
    });

    wrap.addEventListener('dragleave', (e) => {
      // only clear if leaving the wrap entirely
      if (!wrap.contains(e.relatedTarget)) {
        wrap.classList.remove('drop-indicator-before','drop-indicator-after','drop-indicator-inside');
      }
    });

    wrap.addEventListener('drop', (e) => {
      if (!dragState || !dragState.targetId) return;
      e.preventDefault();
      e.stopPropagation();
      performDrop(dragState);
      clearDropIndicators();
    });
  }

  function clearDropIndicators() {
    $tree.querySelectorAll('.drop-indicator-before,.drop-indicator-after,.drop-indicator-inside')
      .forEach(el => el.classList.remove('drop-indicator-before','drop-indicator-after','drop-indicator-inside'));
  }

  function performDrop(ds) {
    const rm = currentRoadmap();
    const srcRef = findNode(rm.children, ds.nodeId);
    const tgtRef = findNode(rm.children, ds.targetId);
    if (!srcRef || !tgtRef) return;
    if (srcRef.node === tgtRef.node) return;
    if (isDescendant(srcRef.node, tgtRef.node.id)) return;

    // Remove from source parent
    const fromIdx = srcRef.parent.indexOf(srcRef.node);
    srcRef.parent.splice(fromIdx, 1);

    if (ds.zone === 'inside') {
      tgtRef.node.children = tgtRef.node.children || [];
      tgtRef.node.children.push(srcRef.node);
      tgtRef.node.expanded = true;
    } else {
      // Find parent array & index of target post-removal
      const tgtRef2 = findNode(rm.children, ds.targetId);
      const idx = tgtRef2.parent.indexOf(tgtRef2.node);
      const insertIdx = ds.zone === 'before' ? idx : idx + 1;
      tgtRef2.parent.splice(insertIdx, 0, srcRef.node);
    }

    save();
    render();
  }

  /* ---------------- 9. Roadmap manager ---------------- */

  const $roadmapBtn  = document.getElementById('roadmapMenuBtn');
  const $roadmapMenu = document.getElementById('roadmapMenu');
  const $roadmapList = document.getElementById('roadmapList');

  $roadmapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    $roadmapMenu.classList.toggle('hidden');
    if (!$roadmapMenu.classList.contains('hidden')) renderRoadmapList();
  });
  document.addEventListener('click', (e) => {
    if (!$roadmapMenu.contains(e.target) && e.target !== $roadmapBtn) {
      $roadmapMenu.classList.add('hidden');
    }
  });

  function renderRoadmapList() {
    $roadmapList.innerHTML = '';
    for (const r of state.roadmaps) {
      const item = document.createElement('div');
      item.className = 'roadmap-item' + (r.id === state.currentId ? ' is-current' : '');
      const pct = stats(r.children).pct;
      item.innerHTML = `
        <span class="truncate">${escapeHtml(r.name)}</span>
        <span class="pct">${pct}%</span>
      `;
      item.addEventListener('click', () => {
        state.currentId = r.id;
        save();
        render();
        $roadmapMenu.classList.add('hidden');
      });
      $roadmapList.appendChild(item);
    }
  }

  $roadmapMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    if (a === 'new-roadmap') newRoadmap();
    else if (a === 'duplicate-roadmap') duplicateRoadmap();
    else if (a === 'delete-roadmap') deleteRoadmap();
    $roadmapMenu.classList.add('hidden');
  });

  function newRoadmap() {
    showPrompt({
      title: 'New roadmap',
      desc: 'Give your roadmap a name. You can rename it later.',
      placeholder: 'e.g. Frontend Engineer',
      confirmText: 'Create',
      onConfirm: (name) => {
        if (!name || !name.trim()) return;
        const r = {
          id: 'rm_' + uid(),
          name: name.trim(),
          description: '',
          createdAt: Date.now(),
          children: [],
        };
        state.roadmaps.push(r);
        state.currentId = r.id;
        save();
        render();
        toast('Roadmap created');
      },
    });
  }

  function duplicateRoadmap() {
    const rm = currentRoadmap();
    if (!rm) return;
    const copy = JSON.parse(JSON.stringify(rm));
    copy.id = 'rm_' + uid();
    copy.name = rm.name + ' (copy)';
    copy.createdAt = Date.now();
    reassignIds(copy.children);
    state.roadmaps.push(copy);
    state.currentId = copy.id;
    save();
    render();
    toast('Roadmap duplicated');
  }

  function deleteRoadmap() {
    if (state.roadmaps.length <= 1) {
      toast('You need at least one roadmap');
      return;
    }
    const rm = currentRoadmap();
    showModal({
      title: 'Delete roadmap',
      desc: `Delete "${rm.name}" and all its tasks? This cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
      onConfirm: () => {
        state.roadmaps = state.roadmaps.filter(r => r.id !== rm.id);
        state.currentId = state.roadmaps[0].id;
        save();
        render();
        toast('Roadmap deleted');
      },
    });
  }

  /* ----- Import / Export ----- */

  document.getElementById('exportBtn').addEventListener('click', () => {
    const rm = currentRoadmap();
    const blob = new Blob([JSON.stringify(rm, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rm.name.replace(/\s+/g, '_').toLowerCase()}_roadmap.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported');
  });

  const $importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => $importFile.click());
  $importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!obj || !obj.name || !Array.isArray(obj.children)) throw new Error('Invalid format');
      const imported = {
        id: 'rm_' + uid(),
        name: obj.name,
        description: obj.description || '',
        createdAt: Date.now(),
        children: obj.children,
      };
      reassignIds(imported.children);
      // Normalize nodes (ensure required fields exist)
      walk(imported.children, (n) => {
        n.done       = !!n.done;
        n.notes      = n.notes || '';
        n.resources  = Array.isArray(n.resources) ? n.resources : [];
        n.children   = Array.isArray(n.children) ? n.children : [];
        n.expanded   = !!n.expanded;
        n.title      = String(n.title || 'Untitled');
      });
      state.roadmaps.push(imported);
      state.currentId = imported.id;
      save();
      render();
      toast('Roadmap imported');
    } catch (err) {
      console.error(err);
      toast('Import failed: invalid JSON');
    } finally {
      e.target.value = '';
    }
  });

  /* ---------------- 10. Theme & shortcuts ---------------- */

  function applyTheme(t) {
    if (t === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem(THEME_KEY, t);
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
    else applyTheme('light');
  }

  document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  /* Top-bar buttons */
  document.getElementById('expandAllBtn').addEventListener('click', () => setExpansion(true));
  document.getElementById('collapseAllBtn').addEventListener('click', () => setExpansion(false));
  document.getElementById('addRootBtn').addEventListener('click', addRoot);
  document.getElementById('helpBtn').addEventListener('click', () => openHelp());
  document.getElementById('helpClose').addEventListener('click', () => closeHelp());
  document.getElementById('searchMobileBtn').addEventListener('click', () => {
    const v = prompt('Search tasks:');
    if (v !== null) {
      searchQuery = v.trim();
      $searchInput.value = searchQuery;
      applySearch(searchQuery);
    }
  });

  function setExpansion(open) {
    walk(currentRoadmap().children, (n) => {
      if (n.children && n.children.length) n.expanded = open;
    });
    save();
    render();
  }

  /* Keyboard shortcuts */
  document.addEventListener('keydown', (e) => {
    const inField = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;

    // Esc — close drawer/modal/help
    if (e.key === 'Escape') {
      if (!document.getElementById('helpBackdrop').classList.contains('hidden') && document.getElementById('helpBackdrop').classList.contains('is-open')) {
        closeHelp(); return;
      }
      if (document.getElementById('modalBackdrop').classList.contains('is-open')) {
        closeModal(); return;
      }
      if ($drawer.classList.contains('is-open')) {
        closeDrawer(); return;
      }
      if (searchQuery) {
        searchQuery = '';
        $searchInput.value = '';
        applySearch('');
        return;
      }
    }

    // Cmd/Ctrl + K → focus search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $searchInput.focus();
      $searchInput.select();
      return;
    }
    // Cmd/Ctrl + J → theme
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      const isDark = document.documentElement.classList.contains('dark');
      applyTheme(isDark ? 'light' : 'dark');
      return;
    }
    // Cmd/Ctrl + E → expand all, Shift adds → collapse
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      setExpansion(!e.shiftKey);
      return;
    }

    if (inField) return;

    // N → new section
    if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      addRoot();
      return;
    }
    // ? → help
    if (e.key === '?') {
      e.preventDefault();
      openHelp();
    }
  });

  /* ---------------- Modal helpers ---------------- */

  const $modalBackdrop = document.getElementById('modalBackdrop');
  const $modalTitle    = document.getElementById('modalTitle');
  const $modalDesc     = document.getElementById('modalDesc');
  const $modalBody     = document.getElementById('modalBody');
  const $modalConfirm  = document.getElementById('modalConfirm');
  const $modalCancel   = document.getElementById('modalCancel');

  let modalOnConfirm = null;

  function showModal({ title, desc, confirmText='Confirm', danger=false, body='', onConfirm }) {
    $modalTitle.textContent = title;
    $modalDesc.textContent  = desc || '';
    $modalBody.innerHTML    = body || '';
    $modalConfirm.textContent = confirmText;
    if (danger) {
      $modalConfirm.classList.remove('bg-ink-900','dark:bg-white','text-white','dark:text-ink-900');
      $modalConfirm.classList.add('bg-red-600','text-white','hover:bg-red-700');
    } else {
      $modalConfirm.classList.add('bg-ink-900','dark:bg-white','text-white','dark:text-ink-900');
      $modalConfirm.classList.remove('bg-red-600','hover:bg-red-700');
    }
    modalOnConfirm = onConfirm;
    $modalBackdrop.classList.add('is-open');
  }

  function closeModal() {
    $modalBackdrop.classList.remove('is-open');
    modalOnConfirm = null;
  }

  $modalCancel.addEventListener('click', closeModal);
  $modalBackdrop.addEventListener('click', (e) => {
    if (e.target === $modalBackdrop) closeModal();
  });
  $modalConfirm.addEventListener('click', () => {
    const inp = $modalBody.querySelector('input,textarea');
    const val = inp ? inp.value : null;
    if (modalOnConfirm) modalOnConfirm(val);
    closeModal();
  });

  function showPrompt({ title, desc, placeholder, confirmText='OK', defaultValue='', onConfirm }) {
    const body = `<input type="text" class="w-full bg-transparent border border-ink-200 dark:border-ink-800 focus:border-ink-400 dark:focus:border-ink-600 rounded-md px-3 py-2 text-sm outline-none" placeholder="${escapeAttr(placeholder||'')}" value="${escapeAttr(defaultValue)}" />`;
    showModal({ title, desc, confirmText, body, onConfirm });
    requestAnimationFrame(() => {
      const inp = $modalBody.querySelector('input');
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  /* ---------------- Help modal ---------------- */
  const $helpBackdrop = document.getElementById('helpBackdrop');
  function openHelp() { $helpBackdrop.classList.add('is-open'); }
  function closeHelp() { $helpBackdrop.classList.remove('is-open'); }
  $helpBackdrop.addEventListener('click', (e) => {
    if (e.target === $helpBackdrop) closeHelp();
  });

  /* ---------------- Toast ---------------- */
  const $toast = document.getElementById('toast');
  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove('is-visible'), 2200);
  }

  /* ---------------- Escaping helpers ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------------- 11. Boot ---------------- */
  function boot() {
    initTheme();
    load();
    render();
    // initial dashboard animation
    anime({
      targets: '#overallBar',
      width: stats(currentRoadmap().children).pct + '%',
      duration: 900,
      easing: 'easeOutExpo',
    });
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
