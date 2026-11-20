(function () {
  'use strict';

  const MAX_ATTEMPTS = 6;
  const NUM_SLOTS = 5;
  let targetPuzzle;
  let standaloneComponents;
  let charCombos;
  let seqLookup = {};
  let currentRow = 0;
  let currentSlots = [];
  let isGameOver = false;
  let isSubmitting = false;
  let didWinGame = false;
  let showValidationErrors = false;
  const submittedSequences = new Set();
  const guessHistoryStatuses = [];
  const keyStates = {};

  function modalBlockingGame() {
    for (const id of ['modal-help', 'modal-result']) {
      const modal = document.getElementById(id);
      if (modal && !modal.classList.contains('hidden')) return true;
    }
    return false;
  }

  function tryLockPortrait() {
    try {
      if (window.innerWidth < 600 && screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('portrait').catch(() => {});
      }
    } catch (_) {}
  }

  function showToast(msg, duration = 2000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'px-4 py-1.5 rounded-xl bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 font-bold text-xs sm:text-sm shadow-xl animate-pop text-center';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, duration);
  }

  function greedyAssemble(slots) {
    const segments = [];
    let idx = 0;
    while (idx < slots.length) {
      let matched = false;
      for (let len = Math.min(5, slots.length - idx); len >= 2; len--) {
        const sub = slots.slice(idx, idx + len);
        const chars = seqLookup[sub.join('+')];
        if (chars && chars.length) {
          segments.push({ parts: sub, char: chars[0], altChars: chars.slice(1), valid: true });
          idx += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        const comp = slots[idx];
        segments.push({ parts: [comp], char: standaloneComponents.has(comp) ? comp : null, altChars: [], valid: standaloneComponents.has(comp) });
        idx++;
      }
    }
    return segments;
  }

  function renderKeyboard(rows) {
    const grid = document.getElementById('keyboard-grid');
    if (!grid) return;
    grid.innerHTML = '';

    rows.forEach(row => {
      row.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.comp = item.comp;
        btn.className = 'kb-btn m-0 relative h-12 sm:h-[54px] rounded-xl font-medium text-lg sm:text-xl flex items-center justify-center transition active:scale-95 bg-[#e5e5ea] dark:bg-[#3a3a3c] text-[#1d1d1f] dark:text-[#f5f5f7]';
        const main = document.createElement('span');
        main.textContent = item.comp;
        btn.appendChild(main);
        if (item.variant) {
          const variant = document.createElement('span');
          variant.className = 'absolute bottom-1 right-1.5 text-[10px] sm:text-[11px] leading-none font-normal tracking-tighter opacity-65 pointer-events-none';
          variant.textContent = `(${item.variant})`;
          btn.appendChild(variant);
        }
        btn.addEventListener('click', () => handleInputComponent(item.comp));
        grid.appendChild(btn);
      });
    });

    const backBtn = document.createElement('button');
    backBtn.id = 'key-backspace';
    backBtn.type = 'button';
    backBtn.title = '倒退 (Backspace)';
    backBtn.setAttribute('aria-label', '倒退');
    backBtn.className = 'm-0 relative h-12 sm:h-[54px] rounded-xl bg-[#d1d1d6] dark:bg-[#2c2c2e] hover:opacity-90 text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center justify-center transition active:scale-95';
    backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6 6-6z"/><path d="M12 10l4 4"/><path d="M16 10l-4 4"/></svg>';
    backBtn.addEventListener('click', handleBackspace);
    grid.appendChild(backBtn);
  }

  function updateKeyboardColors() {
    document.querySelectorAll('#keyboard-grid button[data-comp]').forEach(btn => {
      const comp = btn.dataset.comp;
      const state = keyStates[comp];
      btn.className = 'kb-btn m-0 relative h-12 sm:h-[54px] rounded-xl font-medium text-lg sm:text-xl flex items-center justify-center transition active:scale-95';
      if (state === 'correct') btn.classList.add('bg-[#5f8d6b]', 'text-white');
      else if (state === 'present') btn.classList.add('bg-[#bfa054]', 'text-white');
      else if (state === 'absent') btn.classList.add('bg-[#787c7e]', 'dark:bg-[#222224]', 'text-white', 'dark:text-[#6e6e73]');
      else btn.classList.add('bg-[#e5e5ea]', 'dark:bg-[#3a3a3c]', 'text-[#1d1d1f]', 'dark:text-[#f5f5f7]');
    });
  }

  function clearCompositionPreview() {
    currentSlots = [];
    showValidationErrors = false;
    const container = document.getElementById('live-groups-container');
    if (container) container.innerHTML = '<span class="text-sm text-stone-400 dark:text-zinc-500">送出答案不須成詞</span>';
    for (let i = 0; i < NUM_SLOTS; i++) {
      const tile = document.getElementById(`tile-${currentRow}-${i}`);
      if (tile) {
        tile.textContent = '';
        tile.className = 'board-tile border-2 border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center font-bold transition-colors';
      }
    }
  }

  function renderCurrentRowAndPreview() {
    if (currentRow >= MAX_ATTEMPTS) return;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const tile = document.getElementById(`tile-${currentRow}-${i}`);
      if (!tile) continue;
      const val = currentSlots[i] || '';
      tile.textContent = val;
      tile.className = 'board-tile border-2 flex items-center justify-center font-bold transition-colors bg-white dark:bg-zinc-900';
      tile.classList.add(val ? 'border-stone-400' : 'border-stone-300', val ? 'dark:border-zinc-600' : 'dark:border-zinc-700');
      if (val) tile.classList.add('text-[#1d1d1f]', 'dark:text-[#f5f5f7]');
    }

    const container = document.getElementById('live-groups-container');
    if (!container) return;
    container.innerHTML = '';
    if (!currentSlots.length) {
      container.innerHTML = '<span class="text-sm text-stone-400 dark:text-zinc-500">送出答案不須成詞</span>';
      return;
    }
    greedyAssemble(currentSlots).forEach(seg => {
      const span = document.createElement('span');
      span.className = 'font-bold text-lg sm:text-xl tracking-wide text-[#1d1d1f] dark:text-[#f5f5f7]';
      span.textContent = seg.valid
        ? seg.char + (seg.altChars.length ? '/' + seg.altChars.join('/') : '')
        : (showValidationErrors ? `${seg.parts[0]}?` : seg.parts[0]);
      container.appendChild(span);
    });
  }

  function handleInputComponent(comp) {
    tryLockPortrait();
    if (isGameOver || isSubmitting || modalBlockingGame()) return;
    if (currentSlots.length >= NUM_SLOTS) {
      showToast('已填滿 5 個部件，請按「送出」或倒退鍵');
      return;
    }
    showValidationErrors = false;
    currentSlots.push(comp);
    renderCurrentRowAndPreview();
    const tile = document.getElementById(`tile-${currentRow}-${currentSlots.length - 1}`);
    if (tile) {
      tile.classList.remove('animate-pop');
      void tile.offsetWidth;
      tile.classList.add('animate-pop');
    }
  }

  function handleBackspace() {
    if (isGameOver || isSubmitting || modalBlockingGame() || !currentSlots.length) return;
    showValidationErrors = false;
    currentSlots.pop();
    renderCurrentRowAndPreview();
  }

  function evaluateGuess(guess, target) {
    const result = Array(NUM_SLOTS).fill('absent');
    const count = {};
    target.forEach(part => count[part] = (count[part] || 0) + 1);
    for (let i = 0; i < NUM_SLOTS; i++) {
      if (guess[i] === target[i]) {
        result[i] = 'correct';
        count[guess[i]]--;
      }
    }
    for (let i = 0; i < NUM_SLOTS; i++) {
      if (result[i] !== 'correct' && count[guess[i]] > 0) {
        result[i] = 'present';
        count[guess[i]]--;
      }
    }
    return result;
  }

  function triggerShake() {
    const row = document.getElementById(`row-${currentRow}`);
    const actionBar = document.getElementById('bottom-action-bar');
    [row, actionBar].forEach(el => {
      if (!el) return;
      el.classList.remove('animate-shake');
      void el.offsetWidth;
      el.classList.add('animate-shake');
    });
  }

  function showResultModal(isWin) {
    didWinGame = isWin;
    document.getElementById('result-status-text').textContent = isWin ? '恭喜答對！' : '6次機會已用完，本次答案為';
    document.getElementById('result-word-display').textContent = targetPuzzle.word;
    const slots = document.getElementById('result-slots-display');
    slots.innerHTML = '';
    targetPuzzle.slots.forEach(part => {
      const box = document.createElement('span');
      box.className = 'w-11 h-11 bg-stone-100 dark:bg-zinc-800 border border-stone-300 dark:border-zinc-700 flex items-center justify-center font-bold text-lg sm:text-xl text-[#1d1d1f] dark:text-[#f5f5f7]';
      box.textContent = part;
      slots.appendChild(box);
    });
    document.getElementById('modal-result').classList.remove('hidden');
    document.getElementById('btn-show-result').classList.remove('hidden');
  }

  function buildShareText() {
    const score = didWinGame ? `${guessHistoryStatuses.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
    const map = { correct: '🟩', present: '🟨', absent: '⬛' };
    const rows = guessHistoryStatuses.map(row => row.map(state => map[state] || '⬛').join('')).join('\n');
    return `部件 wordle ${score}\n\n${rows}`;
  }

  function fallbackCopy(text, callback) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (document.execCommand('copy')) callback();
      else showToast('複製失敗，請手動選取複製');
    } catch (_) {
      showToast('複製失敗，請手動選取複製');
    }
    document.body.removeChild(textarea);
  }

  function handleShare() {
    const text = buildShareText();
    const label = document.getElementById('btn-share-label');
    const done = () => {
      if (label) {
        label.textContent = '已複製結果！';
        setTimeout(() => label.textContent = '分享結果', 2000);
      }
      showToast('已複製戰績到剪貼簿');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }

  function handleSubmit() {
    tryLockPortrait();
    if (isGameOver || isSubmitting || modalBlockingGame()) return;
    if (currentSlots.length < NUM_SLOTS) {
      triggerShake();
      showToast('請先填滿 5 個部件！');
      return;
    }
    const key = currentSlots.join('');
    if (submittedSequences.has(key)) {
      triggerShake();
      showToast('已輸入過相同的部件順序');
      return;
    }
    const invalid = greedyAssemble(currentSlots).find(seg => !seg.valid);
    if (invalid) {
      showValidationErrors = true;
      renderCurrentRowAndPreview();
      triggerShake();
      showToast(`部件「${invalid.parts[0]}」無法單獨成字`, 2200);
      return;
    }

    isSubmitting = true;
    submittedSequences.add(key);
    showValidationErrors = false;
    const guess = [...currentSlots];
    const statuses = evaluateGuess(guess, targetPuzzle.slots);
    guessHistoryStatuses.push([...statuses]);

    const priority = { correct: 3, present: 2, absent: 1 };
    guess.forEach((comp, i) => {
      if (!keyStates[comp] || priority[statuses[i]] > priority[keyStates[comp]]) keyStates[comp] = statuses[i];
    });

    const rowToFlip = currentRow;
    for (let i = 0; i < NUM_SLOTS; i++) {
      const tile = document.getElementById(`tile-${rowToFlip}-${i}`);
      setTimeout(() => {
        if (!tile) return;
        tile.classList.add('animate-flip');
        setTimeout(() => {
          tile.textContent = guess[i];
          tile.className = 'board-tile border-2 border-transparent flex items-center justify-center font-bold text-white transition-colors';
          if (statuses[i] === 'correct') tile.classList.add('bg-[#5f8d6b]');
          else if (statuses[i] === 'present') tile.classList.add('bg-[#bfa054]');
          else tile.classList.add('bg-[#787c7e]', 'dark:bg-[#222224]');
        }, 220);
      }, i * 100);
    }

    const isWin = statuses.every(state => state === 'correct');
    currentRow++;
    currentSlots = [];
    setTimeout(() => {
      isSubmitting = false;
      updateKeyboardColors();
      if (isWin || currentRow >= MAX_ATTEMPTS) {
        isGameOver = true;
        showResultModal(isWin);
      } else {
        renderCurrentRowAndPreview();
        ensureActiveRowVisible();
      }
    }, NUM_SLOTS * 100 + 250);
  }

  function ensureActiveRowVisible(instant = false) {
    const container = document.getElementById('grid-scroll-container');
    const row = document.getElementById(`row-${Math.min(currentRow, MAX_ATTEMPTS - 1)}`);
    if (!container || !row) return;
    const c = container.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < c.top + 8 || r.bottom > c.bottom - 8) {
      row.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  function initGame() {
    tryLockPortrait();
    ensureActiveRowVisible(true);

    document.getElementById('key-enter')?.addEventListener('click', handleSubmit);
    document.getElementById('btn-help')?.addEventListener('click', () => document.getElementById('modal-help').classList.remove('hidden'));

    document.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.fixed');
        if (!modal) return;
        modal.classList.add('hidden');
        if (modal.id === 'modal-result' && isGameOver) clearCompositionPreview();
      });
    });
    document.querySelectorAll('.fixed[id^="modal-"]').forEach(modal => {
      modal.addEventListener('click', event => {
        if (event.target === modal) {
          modal.classList.add('hidden');
          if (modal.id === 'modal-result' && isGameOver) clearCompositionPreview();
        }
      });
    });

    document.getElementById('btn-show-result')?.addEventListener('click', () => {
      if (isGameOver) showResultModal(didWinGame);
    });
    document.getElementById('btn-share-result')?.addEventListener('click', handleShare);
    document.getElementById('btn-theme')?.addEventListener('click', () => document.documentElement.classList.toggle('dark'));

    document.getElementById('btn-toggle-examples')?.addEventListener('click', () => {
      const content = document.getElementById('examples-content');
      const arrow = document.getElementById('examples-arrow');
      const hidden = content.classList.toggle('hidden');
      arrow.textContent = hidden ? '▸' : '▾';
      document.getElementById('btn-toggle-examples').setAttribute('aria-expanded', String(!hidden));
    });
    document.getElementById('btn-toggle-principles')?.addEventListener('click', () => {
      const content = document.getElementById('principles-content');
      const arrow = document.getElementById('principles-arrow');
      const hidden = content.classList.toggle('hidden');
      arrow.textContent = hidden ? '▸' : '▾';
      document.getElementById('btn-toggle-principles').setAttribute('aria-expanded', String(!hidden));
    });

    window.addEventListener('resize', () => {
      if (!isGameOver) ensureActiveRowVisible(true);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Backspace') {
        event.preventDefault();
        handleBackspace();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    });
  }

  async function startGame() {
    try {
      const response = await fetch('./game-data.json');
      if (!response.ok) throw new Error(`無法載入 game-data.json: ${response.status}`);
      const data = await response.json();
      targetPuzzle = data.targetPuzzle;
      standaloneComponents = new Set(data.standaloneComponents);
      charCombos = data.charCombos;
      charCombos.forEach(item => {
        const key = item.parts.join('+');
        if (!seqLookup[key]) seqLookup[key] = [];
        if (!seqLookup[key].includes(item.char)) seqLookup[key].push(item.char);
      });
      renderKeyboard(data.keyboardRows);
      initGame();
    } catch (error) {
      console.error(error);
      showToast('無法載入 game-data.json，請確認使用網頁伺服器開啟');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startGame);
  else startGame();
})();
