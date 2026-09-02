(() => {
  const root = document.documentElement;
  const splash = document.querySelector('#splash');
  const scrim = document.querySelector('#scrim');
  const library = document.querySelector('#library-sheet');
  const source = document.querySelector('#source-layer');
  const appShell = document.querySelector('#app-shell');
  const commandDialog = document.querySelector('#command-dialog');
  const island = document.querySelector('#dynamic-island');
  const islandCopy = document.querySelector('#island-copy');
  const islandAction = document.querySelector('#island-action');
  const views = [...document.querySelectorAll('.mode-view')];
  const modeTabs = [...document.querySelectorAll('.mode-tab')];
  let islandTimer = null;
  let layerReturnFocus = null;
  let sourceSaveTimer = null;
  let undoFn = null;

  const iconUse = (id) => {
    const use = island.querySelector('use');
    if (use) use.setAttribute('href', id);
  };

  function announce(message, { tone = 'success', action = '', persistent = false } = {}) {
    window.clearTimeout(islandTimer);
    islandCopy.textContent = message;
    island.classList.toggle('attention', persistent || Boolean(action) || message.length > 20);
    islandAction.hidden = !action;
    islandAction.textContent = action;
    island.dataset.tone = tone;
    iconUse(tone === 'success' ? '#i-check' : tone === 'working' ? '#i-spark' : '#i-more');
    if (!persistent) {
      islandTimer = window.setTimeout(() => {
        island.classList.remove('attention');
        islandAction.hidden = true;
        islandCopy.textContent = '所有更改已保存';
        iconUse('#i-check');
      }, 2600);
    }
  }

  function dismissSplash() {
    if (!splash || splash.classList.contains('hidden')) return;
    splash.classList.add('hidden');
    window.setTimeout(() => announce('玄雾纪行 v2.4 已载入'), 380);
  }

  splash?.addEventListener('click', dismissSplash);
  window.setTimeout(dismissSplash, 1350);

  function setMode(mode, focusTab = false) {
    const target = document.querySelector(mode === 'design' ? '#view-design' : '#view-content');
    views.forEach((view) => {
      const active = view === target;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });
    modeTabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });
    document.querySelectorAll('.dock-button[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });
    announce(mode === 'design' ? '已进入内核设计' : '已返回内容画布', { tone: 'working' });
  }

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setMode(button.dataset.mode);
      if (button.hasAttribute('data-close')) closeLayers();
    });
  });

  modeTabs.forEach((tab, index) => {
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = modeTabs[(index + direction + modeTabs.length) % modeTabs.length];
      setMode(next.dataset.mode, true);
    });
  });

  function openLibrary() {
    layerReturnFocus = document.activeElement;
    if (source.classList.contains('open')) closeSource(false);
    appShell.inert = true;
    library.inert = false;
    scrim.hidden = false;
    library.classList.add('open');
    library.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => document.querySelector('#kernel-search')?.focus(), 20);
  }

  function closeLibrary(restoreFocus = true) {
    library.classList.remove('open');
    library.setAttribute('aria-hidden', 'true');
    library.inert = true;
    appShell.inert = false;
    scrim.hidden = true;
    if (restoreFocus && layerReturnFocus instanceof HTMLElement) layerReturnFocus.focus();
  }

  function openSource() {
    layerReturnFocus = document.activeElement;
    closeLibrary(false);
    appShell.inert = true;
    source.inert = false;
    source.classList.add('open');
    source.setAttribute('aria-hidden', 'false');
    window.setTimeout(() => document.querySelector('#source-editor')?.focus(), 20);
  }

  function closeSource(restoreFocus = true) {
    source.classList.remove('open');
    source.setAttribute('aria-hidden', 'true');
    source.inert = true;
    appShell.inert = false;
    if (restoreFocus && layerReturnFocus instanceof HTMLElement) layerReturnFocus.focus();
  }

  function openCommand(prefill = '') {
    if (commandDialog.open) return;
    layerReturnFocus = document.activeElement;
    commandDialog.showModal();
    const input = document.querySelector('#command-input');
    input.value = prefill;
    filterCommands(prefill);
    window.setTimeout(() => input.focus(), 0);
  }

  function closeLayers() {
    if (source.classList.contains('open')) closeSource();
    if (library.classList.contains('open')) closeLibrary();
    if (gallery.classList.contains('open')) closeGallery();
    if (settings.classList.contains('open')) closeSettings();
    if (commandDialog.open) commandDialog.close();
  }

  document.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.open;
      hidePop();
      if (target === 'library') openLibrary();
      if (target === 'source') openSource();
      if (target === 'command') openCommand();
      if (target === 'search') openCommand('搜索');
      if (target === 'gallery') openGallery();
      if (target === 'settings') openSettings();
      if (target === 'guide') openGuide();
      if (target === 'story-search') openStorySearch();
      if (target === 'world-menu') showPop(worldMenuPop, button);
    });
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.closest('#source-layer')) closeSource();
      else if (button.closest('#gallery-layer')) closeGallery();
      else if (button.closest('#settings-sheet')) closeSettings();
      else closeLibrary();
    });
  });

  scrim.addEventListener('click', () => {
    if (source.classList.contains('open')) closeSource();
    if (gallery.classList.contains('open')) closeGallery();
    if (settings.classList.contains('open')) closeSettings();
    if (library.classList.contains('open')) closeLibrary();
  });
  commandDialog.addEventListener('close', () => {
    if (layerReturnFocus instanceof HTMLElement) layerReturnFocus.focus();
  });

  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    announce(next === 'dark' ? '已切换为深色主题' : '已切换为浅色主题', { tone: 'working' });
  });

  document.querySelectorAll('[data-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.querySelector('#content-input');
      input.value = button.dataset.choice;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });

  function addStoryReceipt(action) {
    const copy = document.querySelector('.story-copy');
    const receipt = document.createElement('blockquote');
    receipt.textContent = `你的行动已记录：${action}`;
    receipt.dataset.prototypeReceipt = 'true';
    copy.append(receipt);
    document.querySelector('#content-scroller').scrollTo({ top: copy.offsetTop + copy.offsetHeight, behavior: 'smooth' });
  }

  document.querySelector('#content-composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#content-input');
    const value = input.value.trim();
    if (!value) {
      announce('请先描述你的行动', { tone: 'working' });
      input.focus();
      return;
    }
    const send = event.currentTarget.querySelector('.send-button');
    send.disabled = true;
    announce('玄雾纪行正在推进世界…', { tone: 'working', persistent: true });
    window.setTimeout(() => {
      addStoryReceipt(value);
      input.value = '';
      send.disabled = false;
      announce('新回合已生成并保存');
    }, 900);
  });

  document.querySelector('#design-composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#design-input');
    const value = input.value.trim();
    if (!value) {
      announce('请先说明要改变的规则', { tone: 'working' });
      input.focus();
      return;
    }
    const thread = document.querySelector('#design-thread');
    const message = document.createElement('div');
    message.className = 'thread-message user-message';
    message.innerHTML = '<div class="message-label">你</div>';
    const paragraph = document.createElement('p');
    paragraph.textContent = value;
    message.append(paragraph);
    thread.insertBefore(message, thread.querySelector('.kernel-checkpoint'));
    input.value = '';
    announce('设计代理正在重组规则骨架…', { tone: 'working', persistent: true });
    window.setTimeout(() => announce('规则草稿已更新，请检查检查点'), 950);
  });

  document.querySelector('#accept-checkpoint').addEventListener('click', () => {
    const active = document.querySelector('.progress-track .active');
    const next = active?.nextElementSibling;
    active?.classList.remove('active');
    active?.classList.add('complete');
    next?.classList.add('active');
    announce('检查点已接受，进入运行检查');
  });

  document.querySelector('#revise-checkpoint').addEventListener('click', () => {
    const input = document.querySelector('#design-input');
    input.value = '请重新定义冲突事实的优先级，并说明它如何影响长期记忆。';
    input.focus();
    announce('修订要求已放入输入框', { tone: 'working' });
  });

  document.querySelector('#publish-kernel').addEventListener('click', () => {
    const chipText = document.querySelector('#version-chip-text');
    if (chipText.textContent.includes('已发布')) {
      announce('玄雾纪行 v2.5 已是发布版本', { tone: 'working' });
      return;
    }
    chipText.textContent = 'v2.5 · 已发布';
    const topVersion = document.querySelector('#version-list .version-item');
    topVersion.querySelector('strong').textContent = 'v2.5 · 已发布';
    topVersion.querySelector('.menu-note').textContent = '当前世界使用';
    announce('玄雾纪行 v2.5 已发布，版本已归档', { action: '查看版本' });
    undoFn = () => showPop(versionPop, document.querySelector('#version-chip'));
  });

  islandAction.addEventListener('click', () => {
    if (undoFn) { const fn = undoFn; undoFn = null; fn(); return; }
    announce('操作已撤销');
  });

  document.querySelector('#import-kernel').addEventListener('click', () => {
    announce('原型中已进入导入流程', { tone: 'working' });
  });

  const kernelRows = [...document.querySelectorAll('.kernel-row')];
  document.querySelectorAll('.kernel-select').forEach((button) => {
    button.addEventListener('click', () => {
      kernelRows.forEach((row) => {
        row.classList.remove('selected');
        const select = row.querySelector('.kernel-select');
        select.setAttribute('aria-pressed', 'false');
        row.querySelector('.selection-label').textContent = '';
      });
      button.closest('.kernel-row').classList.add('selected');
      button.setAttribute('aria-pressed', 'true');
      button.querySelector('.selection-label').textContent = '已选择';
    });
  });

  document.querySelector('.apply-kernel').addEventListener('click', () => {
    closeLibrary(false);
    setMode('content');
    announce('玄雾纪行 v2.4 已应用到暮色边境', { action: '撤销' });
  });

  function filterKernels() {
    const query = document.querySelector('#kernel-search').value.trim().toLowerCase();
    const filter = document.querySelector('.filter.active')?.dataset.filter || 'all';
    kernelRows.forEach((row) => {
      const matchesText = row.dataset.name.toLowerCase().includes(query);
      const matchesFilter = filter === 'all' || row.dataset.status === filter;
      row.hidden = !(matchesText && matchesFilter);
    });
  }

  document.querySelector('#kernel-search').addEventListener('input', filterKernels);
  document.querySelectorAll('.filter').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      filterKernels();
    });
  });

  const sourceEditor = document.querySelector('#source-editor');
  const sourceSaveState = document.querySelector('#source-save-state');
  sourceEditor.addEventListener('input', () => {
    window.clearTimeout(sourceSaveTimer);
    sourceSaveState.textContent = '未保存 · UTF-8';
    sourceSaveTimer = window.setTimeout(() => {
      sourceSaveState.textContent = '已保存 · UTF-8 · 15.1 KB';
      announce('源码草稿已保存');
    }, 700);
  });

  document.querySelector('#validate-source').addEventListener('click', () => {
    sourceSaveState.textContent = '正在验证…';
    announce('正在运行内核结构审计…', { tone: 'working', persistent: true });
    window.setTimeout(() => {
      sourceSaveState.textContent = '已保存 · 2 项待决定';
      announce('验证完成：2 项需要决定', { tone: 'working' });
    }, 800);
  });

  document.querySelectorAll('.audit-issue').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('[data-source-tab="editor"]').click();
      const line = Number(button.dataset.line);
      const lines = sourceEditor.value.split('\n');
      const start = lines.slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0);
      const end = start + (lines[line - 1]?.length || 0);
      sourceEditor.focus();
      sourceEditor.setSelectionRange(start, end);
      announce(`已定位到第 ${line} 行`, { tone: 'working' });
    });
  });

  document.querySelectorAll('.source-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.sourceTab;
      document.querySelectorAll('.source-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('[data-source-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.sourcePanel === target));
    });
  });

  const commandInput = document.querySelector('#command-input');
  const commandButtons = [...document.querySelectorAll('[data-command]')];
  const commandEmpty = document.querySelector('#command-empty');

  function filterCommands(value) {
    const query = value.trim().toLowerCase();
    let visible = 0;
    commandButtons.forEach((button) => {
      const matches = button.textContent.toLowerCase().includes(query);
      button.hidden = !matches;
      if (matches) visible += 1;
    });
    commandEmpty.hidden = visible > 0;
  }

  commandInput.addEventListener('input', () => filterCommands(commandInput.value));

  function runCommand(command) {
    commandDialog.close();
    if (command === 'design') setMode('design');
    if (command === 'library') openLibrary();
    if (command === 'source') openSource();
    if (command === 'gallery') openGallery();
    if (command === 'settings') openSettings();
    if (command === 'search') openStorySearch();
    if (command === 'guide') openGuide();
    if (command === 'theme') {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      announce(next === 'dark' ? '已切换为深色主题' : '已切换为浅色主题', { tone: 'working' });
    }
    if (command === 'density') {
      const compact = root.dataset.density === 'compact';
      root.dataset.density = compact ? 'comfortable' : 'compact';
      announce(compact ? '信息密度：舒适' : '信息密度：紧凑', { tone: 'working' });
    }
  }

  commandButtons.forEach((button) => button.addEventListener('click', () => runCommand(button.dataset.command)));

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (popState) { hidePop(); return; }
      if (!lightbox.hidden) { lightbox.hidden = true; return; }
      if (guide.classList.contains('open')) { closeGuide(); return; }
      if (!storySearch.hidden) { closeStorySearch(); return; }
      if (source.classList.contains('open')) closeSource();
      else if (gallery.classList.contains('open')) closeGallery();
      else if (settings.classList.contains('open')) closeSettings();
      else if (library.classList.contains('open')) closeLibrary();
      return;
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openStorySearch();
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setMode('design', true);
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      openLibrary();
    }
    if (event.ctrlKey && event.key === '.') {
      event.preventDefault();
      openSource();
    }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      openGallery();
    }
    if (event.ctrlKey && event.key === ',') {
      event.preventDefault();
      openSettings();
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      openCommand();
    }
    if (event.ctrlKey && event.key === 'Enter') {
      const activeView = document.querySelector('.mode-view.active');
      const form = activeView?.querySelector('form.composer');
      if (form && document.activeElement?.closest('form') === form) {
        event.preventDefault();
        form.requestSubmit();
      }
    }
  });

  /* ===== Popover menu system ===== */
  let popState = null;

  function showPop(pop, anchor) {
    if (popState && popState.pop === pop && popState.anchor === anchor) { hidePop(); return; }
    hidePop();
    pop.hidden = false;
    const bottom = window.innerWidth <= 760;
    pop.classList.toggle('anchor-bottom', bottom);
    if (bottom) {
      pop.style.left = '';
      pop.style.top = '';
    } else {
      const rect = anchor.getBoundingClientRect();
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let x;
      let y;
      if (!rect.width && !rect.height) {
        x = Math.max(8, (window.innerWidth - pw) / 2);
        y = 120;
      } else {
        x = Math.min(Math.max(8, rect.left), window.innerWidth - pw - 8);
        y = rect.bottom + 6;
        if (y + ph > window.innerHeight - 8) y = Math.max(8, rect.top - ph - 6);
      }
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    }
    popState = { pop, anchor };
  }

  function hidePop() {
    if (!popState) return;
    popState.pop.hidden = true;
    popState = null;
  }

  // Capture phase: the click that opens a pop must not be treated as an
  // outside click by its own bubbling, so the outside-close check runs before
  // any button handler switches the active pop.
  document.addEventListener('click', (event) => {
    if (!popState) return;
    if (popState.pop.contains(event.target) || popState.anchor.contains(event.target)) return;
    hidePop();
  }, true);

  /* ===== World & session menu ===== */
  const worldMenuPop = document.querySelector('#world-menu-pop');

  worldMenuPop.querySelectorAll('[data-worldline]').forEach((item) => {
    item.addEventListener('click', () => {
      worldMenuPop.querySelectorAll('[data-worldline]').forEach((w) => w.setAttribute('aria-pressed', String(w === item)));
      document.querySelector('.brand-copy span').textContent = item.dataset.worldline;
      announce(`世界线已切换：${item.dataset.worldline}`, { tone: 'working' });
    });
  });

  worldMenuPop.querySelectorAll('[data-session]').forEach((item) => {
    item.addEventListener('click', () => {
      worldMenuPop.querySelectorAll('[data-session]').forEach((s) => s.setAttribute('aria-pressed', String(s === item)));
      announce(`已切换会话：${item.dataset.session}`, { tone: 'working' });
    });
  });

  document.querySelector('#worldline-new').addEventListener('click', () => {
    hidePop();
    announce('新建世界线（原型演示）', { tone: 'working' });
  });

  document.querySelector('#session-new').addEventListener('click', () => {
    hidePop();
    announce('已创建新会话，开始你的故事', { tone: 'working' });
  });

  document.querySelector('#export-package').addEventListener('click', () => {
    hidePop();
    announce('正在打包进度包…', { tone: 'working', persistent: true });
    window.setTimeout(() => announce('进度包已导出到本地'), 900);
  });

  /* ===== Model chips ===== */
  const modelMenuPop = document.querySelector('#model-menu-pop');
  const modelOptions = {
    text: ['远山 v4', '深流 v3', '本地模拟接口'],
    image: ['雾笔 v2', '浮光 v1', '仅手动插图'],
    think: ['快速', '标准', '深入'],
  };

  document.querySelectorAll('[data-model-menu]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const kind = chip.dataset.modelMenu;
      const current = chip.dataset.value;
      modelMenuPop.innerHTML = `<div class="menu-section">${modelOptions[kind].map((option) => `<button class="menu-item" type="button" role="menuitemradio" aria-pressed="${option === current}" data-option="${option}">${option}</button>`).join('')}</div>`;
      modelMenuPop.querySelectorAll('[data-option]').forEach((item) => item.addEventListener('click', () => {
        hidePop();
        chip.dataset.value = item.dataset.option;
        chip.querySelector('span').textContent = `${chip.dataset.prefix} · ${item.dataset.option}`;
        announce(`已切换为 ${item.dataset.option}`, { tone: 'working' });
      }));
      showPop(modelMenuPop, chip);
    });
  });

  /* ===== Choices: multi-select ===== */
  const multiCount = document.querySelector('#multi-count');
  document.querySelectorAll('.choice-row.multi').forEach((row) => {
    row.addEventListener('click', () => {
      const pressed = row.getAttribute('aria-pressed') === 'true';
      row.setAttribute('aria-pressed', String(!pressed));
      const picked = document.querySelectorAll('.choice-row.multi[aria-pressed="true"]').length;
      multiCount.textContent = `已选 ${picked} 项`;
    });
  });

  /* ===== Pending banner ===== */
  document.querySelector('#pending-resolve').addEventListener('click', () => {
    announce('正在进入补录（原型演示）', { tone: 'working' });
  });
  document.querySelector('#pending-dismiss').addEventListener('click', () => {
    document.querySelector('#pending-banner').hidden = true;
    announce('已推迟补录提醒');
  });

  /* ===== Illustration tools ===== */
  document.querySelector('#figure-regen').addEventListener('click', () => {
    announce('正在重绘场景插图…', { tone: 'working', persistent: true });
    window.setTimeout(() => announce('插图已重绘并保存'), 900);
  });
  document.querySelector('#figure-manual').addEventListener('click', () => {
    announce('已选择本地插图（原型演示）', { tone: 'working' });
  });

  /* ===== Design quick prompts ===== */
  document.querySelectorAll('.prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = document.querySelector('#design-input');
      input.value = chip.dataset.prompt;
      input.focus();
      announce('提示已放入输入框', { tone: 'working' });
    });
  });

  /* ===== Version history ===== */
  const versionPop = document.querySelector('#version-pop');
  const versionChip = document.querySelector('#version-chip');
  versionChip.addEventListener('click', () => showPop(versionPop, versionChip));

  document.querySelectorAll('#version-list .version-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#version-list .version-item').forEach((v) => v.setAttribute('aria-pressed', String(v === item)));
      announce(`正在查看 ${item.dataset.version} 版本（只读）`, { tone: 'working' });
    });
  });

  /* ===== Kernel row menu ===== */
  const rowMenuPop = document.querySelector('#row-menu-pop');
  const kernelList = document.querySelector('#kernel-list');
  let menuRow = null;

  function recountLibrary() {
    const rows = [...kernelList.querySelectorAll('.kernel-row')];
    const counts = { all: rows.length, published: 0, draft: 0, archived: 0 };
    rows.forEach((row) => { counts[row.dataset.status] += 1; });
    document.querySelectorAll('.filter-row [data-filter]').forEach((filter) => {
      const span = filter.querySelector('span');
      if (span) span.textContent = String(counts[filter.dataset.filter] ?? 0);
    });
    document.querySelector('#library-count').textContent = `${counts.all} 个内核`;
  }

  document.querySelectorAll('[data-row-menu]').forEach((btn) => {
    btn.addEventListener('click', () => {
      menuRow = btn.closest('.kernel-row');
      document.querySelector('#row-archive-label').textContent = menuRow.dataset.status === 'archived' ? '恢复' : '归档';
      showPop(rowMenuPop, btn);
    });
  });

  rowMenuPop.querySelectorAll('[data-row-action]').forEach((item) => {
    item.addEventListener('click', () => {
      const row = menuRow;
      hidePop();
      if (!row) return;
      const name = row.querySelector('.kernel-leading strong').textContent;
      const action = item.dataset.rowAction;
      if (action === 'source') openSource();
      if (action === 'versions') showPop(versionPop, item);
      if (action === 'template') {
        announce(`「${name}」已另存为模板`, { action: '撤销' });
        undoFn = () => announce('已撤销另存为模板');
      }
      if (action === 'rename') announce(`正在重命名「${name}」（原型演示）`, { tone: 'working' });
      if (action === 'archive') {
        const toArchived = row.dataset.status !== 'archived';
        row.dataset.status = toArchived ? 'archived' : 'published';
        recountLibrary();
        filterKernels();
        announce(toArchived ? `「${name}」已归档` : `「${name}」已恢复为已发布`, { action: '撤销' });
        undoFn = () => {
          row.dataset.status = toArchived ? 'published' : 'archived';
          recountLibrary();
          filterKernels();
        };
      }
      if (action === 'delete') {
        openConfirm({
          title: '删除内核？',
          text: `「${name}」将被永久删除${row.dataset.status === 'published' ? '，绑定它的世界线会回落到默认内核' : ''}。`,
          okText: '删除',
          onOk: () => {
            row.remove();
            recountLibrary();
            filterKernels();
            announce(`「${name}」已删除`, { action: '撤销' });
            undoFn = () => {
              kernelList.appendChild(row);
              recountLibrary();
              filterKernels();
            };
          },
        });
      }
    });
  });

  document.querySelectorAll('[data-row-restore]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.kernel-row');
      row.dataset.status = 'published';
      recountLibrary();
      filterKernels();
      announce(`「${row.querySelector('.kernel-leading strong').textContent}」已恢复为已发布`);
    });
  });

  document.querySelector('#new-template').addEventListener('click', () => {
    announce('已从模板新建内核草稿', { tone: 'working' });
  });

  /* ===== Confirm dialog ===== */
  const confirmDialog = document.querySelector('#confirm-dialog');
  let confirmOkFn = null;

  function openConfirm({ title, text, okText = '确认', input = '', danger = true, onOk }) {
    document.querySelector('#confirm-title').textContent = title;
    document.querySelector('#confirm-text').textContent = text;
    const okButton = document.querySelector('#confirm-ok');
    okButton.textContent = okText;
    okButton.classList.toggle('danger', danger);
    okButton.classList.toggle('primary', !danger);
    const inputWrap = document.querySelector('#confirm-input-wrap');
    const inputField = document.querySelector('#confirm-input');
    inputWrap.hidden = !input;
    inputField.value = input;
    confirmOkFn = onOk || null;
    confirmDialog.showModal();
    if (input) { inputField.focus(); inputField.select(); }
  }

  document.querySelector('#confirm-cancel').addEventListener('click', () => confirmDialog.close());
  document.querySelector('#confirm-ok').addEventListener('click', () => {
    const fn = confirmOkFn;
    const value = document.querySelector('#confirm-input').value.trim();
    confirmOkFn = null;
    confirmDialog.close();
    if (fn) fn(value);
  });

  /* ===== Gallery ===== */
  const gallery = document.querySelector('#gallery-layer');

  function openGallery() {
    layerReturnFocus = document.activeElement;
    hidePop();
    if (source.classList.contains('open')) closeSource(false);
    if (library.classList.contains('open')) closeLibrary(false);
    if (settings.classList.contains('open')) closeSettings(false);
    appShell.inert = true;
    gallery.inert = false;
    scrim.hidden = false;
    gallery.classList.add('open');
    gallery.setAttribute('aria-hidden', 'false');
  }

  function closeGallery(restoreFocus = true) {
    gallery.classList.remove('open');
    gallery.setAttribute('aria-hidden', 'true');
    gallery.inert = true;
    appShell.inert = false;
    scrim.hidden = true;
    if (restoreFocus && layerReturnFocus instanceof HTMLElement) layerReturnFocus.focus();
  }

  document.querySelectorAll('[data-gallery-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-gallery-filter]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      const kind = btn.dataset.galleryFilter;
      document.querySelectorAll('#gallery-grid .gallery-tile').forEach((tile) => {
        tile.hidden = kind !== 'all' && tile.dataset.kind !== kind;
      });
    });
  });

  document.querySelectorAll('.tile-regen').forEach((btn) => {
    btn.addEventListener('click', () => {
      announce('正在重新生成插图…', { tone: 'working', persistent: true });
      window.setTimeout(() => announce('插图已更新'), 900);
    });
  });

  document.querySelector('#gallery-saveall').addEventListener('click', () => announce('已保存全部插图到本地'));
  document.querySelector('#gallery-export').addEventListener('click', () => {
    announce('正在导出进度包…', { tone: 'working', persistent: true });
    window.setTimeout(() => announce('进度包已导出'), 900);
  });
  document.querySelector('#gallery-add').addEventListener('click', () => announce('已选择本地图片（原型演示）', { tone: 'working' }));

  /* ===== Settings ===== */
  const settings = document.querySelector('#settings-sheet');

  function openSettings() {
    layerReturnFocus = document.activeElement;
    hidePop();
    if (source.classList.contains('open')) closeSource(false);
    if (library.classList.contains('open')) closeLibrary(false);
    if (gallery.classList.contains('open')) closeGallery(false);
    appShell.inert = true;
    settings.inert = false;
    scrim.hidden = false;
    settings.classList.add('open');
    settings.setAttribute('aria-hidden', 'false');
  }

  function closeSettings(restoreFocus = true) {
    settings.classList.remove('open');
    settings.setAttribute('aria-hidden', 'true');
    settings.inert = true;
    appShell.inert = false;
    scrim.hidden = true;
    if (restoreFocus && layerReturnFocus instanceof HTMLElement) layerReturnFocus.focus();
  }

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach((t) => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.settings-panel').forEach((panel) => {
        const active = panel.dataset.settingsPanel === tab.dataset.settingsTab;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    });
  });

  document.querySelectorAll('.segmented [data-setting], .swatch[data-setting]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.field').querySelectorAll('[data-setting]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applySetting(btn.dataset.setting, btn.dataset.value);
    });
  });

  document.querySelectorAll('.switch[data-setting]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      btn.dataset.value = on ? 'on' : 'off';
      applySetting(btn.dataset.setting, btn.dataset.value);
    });
  });

  function applySetting(kind, value) {
    if (kind === 'theme') { root.dataset.theme = value; announce(value === 'dark' ? '主题：深色' : '主题：浅色', { tone: 'working' }); }
    if (kind === 'accent') { root.dataset.accent = value; announce('颜色预设已更新', { tone: 'working' }); }
    if (kind === 'fontsize') { root.dataset.fontsize = value; announce('字体大小已更新', { tone: 'working' }); }
    if (kind === 'radius') { root.dataset.radius = value; announce('圆角样式已更新', { tone: 'working' }); }
    if (kind === 'density') { root.dataset.density = value; announce(value === 'compact' ? '信息密度：紧凑' : '信息密度：舒适', { tone: 'working' }); }
    if (kind === 'readw') { root.dataset.readw = value; announce('阅读宽度已更新', { tone: 'working' }); }
    if (kind === 'reduce') { root.classList.toggle('reduce-motion', value === 'on'); announce(value === 'on' ? '减弱动效已开启' : '减弱动效已关闭', { tone: 'working' }); }
    if (kind === 'skipsplash') announce(value === 'on' ? '下次启动将跳过开场动画' : '开场动画已恢复', { tone: 'working' });
    if (kind === 'statusrail') { document.querySelector('#story-rail').hidden = value !== 'on'; announce(value === 'on' ? '状态轨道已显示' : '状态轨道已隐藏', { tone: 'working' }); }
    if (kind === 'illustauto') announce(value === 'on' ? '自动插图已开启' : '已改为仅手动插图', { tone: 'working' });
    if (kind === 'seedlock') announce(value === 'on' ? '出图种子已锁定' : '种子已恢复随机', { tone: 'working' });
  }

  document.querySelector('#setting-text-model').addEventListener('change', (event) => announce(`文本模型：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-image-model').addEventListener('change', (event) => announce(`插图模型：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-api-base').addEventListener('change', () => announce('接口地址已保存'));
  document.querySelector('#check-update').addEventListener('click', () => announce('当前已是最新版本 v1.3.0', { tone: 'working' }));

  /* ===== Choices collapse ===== */
  const choicesBlock = document.querySelector('#choices-toggle')?.closest('.choice-block');
  document.querySelector('#choices-toggle').addEventListener('click', () => {
    const collapsed = choicesBlock.classList.toggle('collapsed');
    const toggle = document.querySelector('#choices-toggle');
    toggle.textContent = collapsed ? '展开' : '收起';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  /* ===== Story search ===== */
  const storySearch = document.querySelector('#story-search');
  const storySearchInput = document.querySelector('#story-search-input');
  const storySearchCount = document.querySelector('#story-search-count');
  let searchHits = [];
  let searchHitIndex = -1;
  let searchDebounce = null;

  function clearSearchHits() {
    document.querySelectorAll('.story-copy mark.search-hit').forEach((mark) => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    searchHits = [];
    searchHitIndex = -1;
  }

  function updateSearchPosition() {
    searchHits.forEach((mark, i) => mark.classList.toggle('current', i === searchHitIndex));
    storySearchCount.textContent = `${searchHits.length ? searchHitIndex + 1 : 0} / ${searchHits.length}`;
    if (searchHits[searchHitIndex]) searchHits[searchHitIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function runStorySearch() {
    clearSearchHits();
    const query = storySearchInput.value.trim();
    if (!query) { storySearchCount.textContent = '0 / 0'; return; }
    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(document.querySelector('.story-copy'), NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.toLowerCase().includes(lowerQuery)) textNodes.push(node);
    }
    textNodes.forEach((textNode) => {
      const text = textNode.textContent;
      const lower = text.toLowerCase();
      const frag = document.createDocumentFragment();
      let pos = 0;
      let at = lower.indexOf(lowerQuery, pos);
      while (at !== -1) {
        frag.append(document.createTextNode(text.slice(pos, at)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(at, at + query.length);
        frag.append(mark);
        searchHits.push(mark);
        pos = at + query.length;
        at = lower.indexOf(lowerQuery, pos);
      }
      frag.append(document.createTextNode(text.slice(pos)));
      textNode.replaceWith(frag);
    });
    searchHitIndex = searchHits.length ? 0 : -1;
    updateSearchPosition();
  }

  function openStorySearch() {
    if (!document.querySelector('#view-content').classList.contains('active')) setMode('content');
    storySearch.hidden = false;
    storySearchInput.focus();
    storySearchInput.select();
  }

  function closeStorySearch() {
    storySearch.hidden = true;
    clearSearchHits();
  }

  storySearchInput.addEventListener('input', () => {
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(runStorySearch, 160);
  });
  storySearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && searchHits.length) {
      event.preventDefault();
      searchHitIndex = (searchHitIndex + 1) % searchHits.length;
      updateSearchPosition();
    }
  });
  document.querySelector('#story-search-prev').addEventListener('click', () => {
    if (!searchHits.length) return;
    searchHitIndex = (searchHitIndex - 1 + searchHits.length) % searchHits.length;
    updateSearchPosition();
  });
  document.querySelector('#story-search-next').addEventListener('click', () => {
    if (!searchHits.length) return;
    searchHitIndex = (searchHitIndex + 1) % searchHits.length;
    updateSearchPosition();
  });
  document.querySelector('#story-search-close').addEventListener('click', closeStorySearch);

  /* ===== Status rail ===== */
  const railPop = document.querySelector('#rail-pop');
  const railTrack = document.querySelector('#rail-track');
  railTrack.addEventListener('click', () => showPop(railPop, railTrack));

  /* ===== World & session management ===== */
  const managePop = document.querySelector('#manage-pop');
  let manageKind = null;

  document.querySelectorAll('[data-manage]').forEach((btn) => {
    btn.addEventListener('click', () => {
      manageKind = btn.dataset.manage;
      renderManagePop();
      showPop(managePop, document.querySelector('[data-open="world-menu"]'));
    });
  });

  function renderManagePop() {
    const selector = manageKind === 'worldline' ? '[data-worldline]' : '[data-session]';
    const items = [...worldMenuPop.querySelectorAll(selector)];
    const label = manageKind === 'worldline' ? '管理世界线' : '管理会话';
    managePop.innerHTML = `<div class="menu-section"><span class="menu-label">${label}</span>${items.map((item, index) => {
      const name = manageKind === 'worldline' ? item.dataset.worldline : item.dataset.session;
      const note = item.querySelector('.menu-note')?.textContent || '';
      const actions = [
        manageKind === 'worldline' ? `<button class="link-button" type="button" data-mi="bind" data-index="${index}">绑定内核</button>` : '',
        `<button class="link-button" type="button" data-mi="rename" data-index="${index}">重命名</button>`,
        `<button class="link-button danger-text" type="button" data-mi="delete" data-index="${index}">删除</button>`,
      ].join('');
      return `<div class="manage-row"><strong>${name}</strong><small>${note}</small>${actions}</div>`;
    }).join('')}</div>`;
    managePop.querySelectorAll('[data-mi]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = worldMenuPop.querySelectorAll(selector)[Number(button.dataset.index)];
        const name = manageKind === 'worldline' ? item.dataset.worldline : item.dataset.session;
        const kindLabel = manageKind === 'worldline' ? '世界线' : '会话';
        const action = button.dataset.mi;
        hidePop();
        if (action === 'bind') {
          openLibrary();
          announce(`为「${name}」选择要绑定的内核`, { tone: 'working' });
        }
        if (action === 'rename') {
          openConfirm({
            title: `重命名${kindLabel}`,
            text: `「${name}」将立即更新到世界菜单。`,
            okText: '重命名',
            input: name,
            danger: false,
            onOk: (value) => {
              if (!value || value === name) return;
              item.dataset[manageKind] = value;
              const textNode = [...item.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
              if (textNode) textNode.textContent = value;
              if (manageKind === 'worldline' && item.getAttribute('aria-pressed') === 'true') {
                document.querySelector('.brand-copy span').textContent = value;
              }
              announce(`已重命名为「${value}」`);
            },
          });
        }
        if (action === 'delete') {
          openConfirm({
            title: `删除${kindLabel}？`,
            text: `「${name}」${manageKind === 'worldline' ? '及其全部会话' : '的全部回合'}将被永久删除。`,
            okText: '删除',
            onOk: () => {
              if (items.length <= 1) {
                announce(`至少保留一条${kindLabel}`, { tone: 'working' });
                return;
              }
              item.remove();
              announce(`「${name}」已删除`, { action: '撤销' });
              undoFn = () => { worldMenuPop.querySelector(`.menu-section`).append(item); };
            },
          });
        }
      });
    });
  }

  /* ===== Guide layer ===== */
  const guide = document.querySelector('#guide-layer');
  let guideStep = 0;

  function setGuideStep(index) {
    guideStep = index;
    guide.querySelectorAll('.guide-step').forEach((step, i) => step.classList.toggle('active', i === index));
    document.querySelector('#guide-next').textContent = index >= 2 ? '开始体验' : '下一步';
  }

  function openGuide() {
    layerReturnFocus = document.activeElement;
    hidePop();
    guide.inert = false;
    guide.classList.add('open');
    guide.setAttribute('aria-hidden', 'false');
    setGuideStep(0);
    document.querySelector('#guide-next').focus();
  }

  function closeGuide(restoreFocus = true) {
    guide.classList.remove('open');
    guide.setAttribute('aria-hidden', 'true');
    guide.inert = true;
    if (restoreFocus && layerReturnFocus instanceof HTMLElement) layerReturnFocus.focus();
  }

  document.querySelector('#guide-next').addEventListener('click', () => {
    if (guideStep >= 2) { closeGuide(); announce('引导完成，开始你的故事'); return; }
    setGuideStep(guideStep + 1);
  });
  document.querySelector('#guide-skip').addEventListener('click', () => {
    closeGuide();
    announce('已跳过新手引导', { tone: 'working' });
  });

  /* ===== Gallery lightbox ===== */
  const lightbox = document.querySelector('#gallery-lightbox');
  const lightboxImg = document.querySelector('#lightbox-img');
  const lightboxCaption = document.querySelector('#lightbox-caption');

  document.querySelectorAll('#gallery-grid .gallery-tile img').forEach((img) => {
    img.addEventListener('click', () => {
      lightboxImg.src = img.src;
      const filter = getComputedStyle(img).filter;
      lightboxImg.style.filter = filter === 'none' ? '' : filter;
      lightboxCaption.textContent = img.closest('.gallery-tile').querySelector('figcaption span').textContent;
      lightbox.hidden = false;
    });
  });

  document.querySelector('#lightbox-close').addEventListener('click', () => { lightbox.hidden = true; });
  document.querySelector('#lightbox-save').addEventListener('click', () => announce('插图已保存到本地'));
  document.querySelector('#lightbox-regen').addEventListener('click', () => {
    announce('正在重新生成插图…', { tone: 'working', persistent: true });
    window.setTimeout(() => announce('插图已更新'), 900);
  });
  lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.hidden = true; });

  /* ===== Settings: extended fields ===== */
  document.querySelector('#setting-ctx').addEventListener('change', (event) => announce(`上下文长度：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-keep').addEventListener('change', (event) => announce(`保留轮数：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-api-key').addEventListener('change', () => announce('接口密钥已保存到系统安全存储'));
  document.querySelector('#setting-illust-size').addEventListener('change', (event) => announce(`出图尺寸：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-illust-style').addEventListener('change', (event) => announce(`画面风格：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-illust-quality').addEventListener('change', (event) => announce(`质量档位：${event.target.value}`, { tone: 'working' }));
  document.querySelector('#setting-illust-negative').addEventListener('change', () => announce('负向词已保存'));
  document.querySelector('#about-export').addEventListener('click', () => {
    announce('正在打包进度包…', { tone: 'working', persistent: true });
    window.setTimeout(() => announce('进度包已导出到本地'), 900);
  });
  document.querySelector('#about-open-data').addEventListener('click', () => announce('正在打开数据文件夹（原型演示）', { tone: 'working' }));
  document.querySelector('#about-clear-cache').addEventListener('click', () => {
    openConfirm({
      title: '清空图片缓存？',
      text: '缓存的过程插图会被删除，已保存到会话与画廊的插图不受影响。',
      okText: '清空',
      onOk: () => announce('图片缓存已清空'),
    });
  });
})();
