(function () {
  'use strict';

  let maxParts = 0;
  const parts = [];
  const collectedWords = [];
  const characters = new Set();
  const submittedByPartCount = new Map();
  const hintedCharacters = new Set();
  const hintMilestones = new Set();
  const revealedHints = [];
  const storageKey = 'component-wordle-master-progress-v1';
  let score = 0;
  let maxScore = 0;
  let hintCount = 0;
  let comboAlternatives = new Map();
  let zhuyinByChar = new Map();
  let allByPartCount = new Map();
  let allCharacters = new Set();
  let cardsPerRow = 0;
  let toastTimer;

  const keyboard = document.getElementById('keyboard');
  const compositionText = document.getElementById('composition-text');
  const resultSlot = document.getElementById('result-slot');
  const collected = document.getElementById('collected-characters');
  const collectionArea = document.getElementById('collection-area');
  const emptyMessage = document.getElementById('empty-message');

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    clearTimeout(toastTimer);
    toast.classList.remove('visible', 'toast-pop');
    void toast.offsetWidth;
    toast.classList.add('visible', 'toast-pop');
    toastTimer = setTimeout(() => toast.classList.remove('visible', 'toast-pop'), 1800);
  }

  function tryLockPortrait() {
    try {
      if (window.innerWidth < 600 && screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('portrait').catch(() => {});
      }
    } catch (_) {}
  }

  function buildShareText() {
    const breakdown = [...allByPartCount.entries()]
      .sort(([left], [right]) => left - right)
      .map(([partCount, allChars]) => {
        const sentCount = submittedByPartCount.get(partCount)?.size || 0;
        return `${partCount} 個部件：${sentCount}/${allChars.size} 個字`;
      });
    return [
      `組字達人｜得分 ${score}`,
      `已收集 ${characters.size} 個字 / 共 ${allCharacters.size} 個字`,
      ...breakdown,
    ].join('\n');
  }

  function saveProgress() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        collectedWords: collectedWords.map(({ char, partCount }) => ({ char, partCount })),
        parts,
        hints: hintCount,
        hintMilestones: [...hintMilestones],
        hintedCharacters: [...hintedCharacters],
        revealedHints,
      }));
    } catch (_) {}
  }

  function restoreProgress(validEntries, availableParts) {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    } catch (_) {
      return;
    }
    if (!saved || typeof saved !== 'object') {
      updateHintCount();
      return;
    }

    if (Array.isArray(saved.collectedWords)) {
      saved.collectedWords.forEach(item => {
        const partCount = Number(item?.partCount);
        const char = item?.char;
        if (!Number.isInteger(partCount) || !validEntries.has(`${partCount}:${char}`) || characters.has(char)) return;
        const word = { char, partCount, points: partCount };
        collectedWords.push(word);
        characters.add(char);
        if (!submittedByPartCount.has(partCount)) submittedByPartCount.set(partCount, new Set());
        submittedByPartCount.get(partCount).add(char);
        score += partCount;
      });
    }
    if (Array.isArray(saved.parts)) {
      parts.push(...saved.parts.filter(part => availableParts.has(part)).slice(0, maxParts));
    }
    const milestoneThresholds = new Set(getMilestoneThresholds());
    if (Array.isArray(saved.hintMilestones)) {
      saved.hintMilestones.forEach(threshold => {
        if (milestoneThresholds.has(Number(threshold))) hintMilestones.add(Number(threshold));
      });
      hintCount = Number.isInteger(saved.hints) ? Math.max(0, saved.hints) : hintMilestones.size * 2;
    }
    if (Array.isArray(saved.hintedCharacters)) {
      saved.hintedCharacters.forEach(char => {
        if (typeof char === 'string' && allCharacters.has(char)) hintedCharacters.add(char);
      });
    }
    if (Array.isArray(saved.revealedHints)) {
      saved.revealedHints.forEach(hint => {
        if (!hint || typeof hint.char !== 'string' || !allCharacters.has(hint.char)) return;
        const readings = Array.isArray(hint.readings)
          ? hint.readings.filter(reading => typeof reading === 'string' && reading)
          : (zhuyinByChar.get(hint.char) || []);
        if (!readings.length) return;
        revealedHints.push({ char: hint.char, readings });
        hintedCharacters.add(hint.char);
      });
    }
    awardReachedMilestoneHints();
    updateHintCount();
    if (collectedWords.length) emptyMessage.hidden = true;
    renderCollectedWords();
    renderComposition();
    updateScoreDisplay();
    renderStats();
  }

  function fallbackCopy(text) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {}
    field.remove();
    return copied;
  }

  async function copyShareResult() {
    const text = buildShareText();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else if (!fallbackCopy(text)) throw new Error('copy failed');
      showToast('已複製分享結果');
    } catch (_) {
      if (fallbackCopy(text)) showToast('已複製分享結果');
      else showToast('複製失敗，請稍後再試');
    }
  }

  function renderComposition() {
    compositionText.replaceChildren();
    resultSlot.textContent = '';
    if (!parts.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'preview-placeholder';
      placeholder.textContent = '選擇部件組字';
      compositionText.appendChild(placeholder);
      return;
    }
    const chars = comboAlternatives.get(parts.join('+'));
    parts.forEach((part, index) => {
      if (index) compositionText.appendChild(createCompositionToken('+', 'composition-operator'));
      compositionText.appendChild(createCompositionToken(part, 'composition-token'));
    });
    if (chars?.length) {
      resultSlot.textContent = `= ${chars.join('/')}`;
    }
  }

  function createCompositionToken(text, className) {
    const token = document.createElement('span');
    token.className = className;
    token.textContent = text;
    return token;
  }

  function addPart(part) {
    tryLockPortrait();
    if (parts.length >= maxParts) {
      showToast(`最多輸入 ${maxParts} 個部件`);
      return;
    }
    parts.push(part);
    renderComposition();
    saveProgress();
  }

  function removePart() {
    if (!parts.length) return;
    parts.pop();
    renderComposition();
    saveProgress();
  }

  function submitComposition() {
    tryLockPortrait();
    if (parts.length < 2) {
      showToast('至少使用兩個部件才能組字');
      return;
    }
    const matches = comboAlternatives.get(parts.join('+')) || [];
    if (!matches.length) {
      showToast('這些部件無法組成單一漢字');
      return;
    }
    const newCharacters = matches.filter(char => !characters.has(char));
    if (!newCharacters.length) {
      showToast(`「${matches.join('、')}」之前已經輸入過`);
      parts.length = 0;
      renderComposition();
      saveProgress();
      return;
    }

    const pointsEarned = parts.length;
    if (!submittedByPartCount.has(parts.length)) submittedByPartCount.set(parts.length, new Set());
    const submittedWords = newCharacters.map(char => ({ char, partCount: parts.length, points: pointsEarned }));
    submittedWords.forEach(word => {
      characters.add(word.char);
      submittedByPartCount.get(parts.length).add(word.char);
      collectedWords.push(word);
    });
    score += pointsEarned * submittedWords.length;
    renderCollectedWords(new Set(submittedWords));
    emptyMessage.hidden = true;

    updateScoreDisplay();
    awardReachedMilestoneHints(true);
    renderStats();
    parts.length = 0;
    renderComposition();
    saveProgress();
  }

  function renderCollectedWords(scorePopupWords = new Set()) {
    if (!cardsPerRow) return;
    collected.replaceChildren();
    const rows = [];
    for (let index = 0; index < collectedWords.length; index += cardsPerRow) {
      rows.push(collectedWords.slice(index, index + cardsPerRow));
    }
    rows.reverse().forEach(rowWords => {
      const row = document.createElement('div');
      row.className = 'collection-row';
      row.style.setProperty('--cards-per-row', String(cardsPerRow));
      rowWords.forEach(word => {
        const card = document.createElement('div');
        card.className = 'collected-card';
        card.style.setProperty('--card-opacity', String(0.7 * word.partCount / maxParts));
        card.setAttribute('aria-label', `${word.char}，${word.points} 分`);

        const character = document.createElement('span');
        character.className = 'collected-char';
        character.textContent = word.char;
        card.appendChild(character);

        if (scorePopupWords.has(word)) {
          const popup = document.createElement('span');
          popup.className = 'score-popup';
          popup.setAttribute('aria-hidden', 'true');
          popup.textContent = `+${word.points}`;
          card.appendChild(popup);
          setTimeout(() => popup.remove(), 1200);
        }
        row.appendChild(card);
      });
      collected.appendChild(row);
    });
  }

  function updateCardsPerRow() {
    const style = getComputedStyle(collectionArea);
    const availableWidth = collectionArea.clientWidth
      - parseFloat(style.paddingLeft)
      - parseFloat(style.paddingRight);
    if (!availableWidth) return;

    const cardSize = Math.min(68, Math.max(48, window.innerWidth * 0.12));
    const cardGap = Math.min(12, Math.max(6, window.innerWidth * 0.015));
    const nextCardsPerRow = Math.max(1, Math.floor((availableWidth + cardGap) / (cardSize + cardGap)));
    if (nextCardsPerRow === cardsPerRow) return;
    cardsPerRow = nextCardsPerRow;
    renderCollectedWords();
  }

  function updateScoreDisplay() {
    const percentage = maxScore ? Math.min(100, (score / maxScore) * 100) : 0;
    document.getElementById('score-value').textContent = String(score);
    const track = document.querySelector('.score-track');
    track.setAttribute('aria-valuenow', String(Math.floor(percentage)));
    const milestones = [...document.querySelectorAll('.score-milestone')];
    let currentMilestone = null;
    milestones.forEach(milestone => {
      const reached = percentage >= Number(milestone.dataset.threshold);
      milestone.classList.toggle('is-reached', reached);
      milestone.classList.remove('is-current');
      if (reached) currentMilestone = milestone;
    });
    currentMilestone?.classList.add('is-current');

    let displayedPercentage = percentage;
    if (currentMilestone && percentage < 100 && track.clientWidth) {
      const threshold = Number(currentMilestone.dataset.threshold);
      const currentIndex = milestones.indexOf(currentMilestone);
      const nextThreshold = currentIndex < milestones.length - 1
        ? Number(milestones[currentIndex + 1].dataset.threshold)
        : 100;
      const markerWidthPercent = (currentMilestone.getBoundingClientRect().width / track.clientWidth) * 100;
      const intervalProgress = Math.max(0, Math.min(1, (percentage - threshold) / (nextThreshold - threshold)));
      const markerOffset = markerWidthPercent * (1 - intervalProgress);
      displayedPercentage = Math.min(100, percentage + markerOffset);
    }
    document.getElementById('score-fill').style.width = `${displayedPercentage}%`;
  }

  function getMilestoneThresholds() {
    return [...document.querySelectorAll('.score-milestone')]
      .map(milestone => Number(milestone.dataset.threshold))
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
  }

  function updateHintCount() {
    document.getElementById('hint-count').textContent = String(hintCount);
    document.getElementById('hint-button').setAttribute('aria-label', `注音提示，${hintCount} 個提示`);
    document.getElementById('hint-modal-count').textContent = String(hintCount);
  }

  function awardReachedMilestoneHints(notify = false) {
    if (!maxScore) return 0;
    const percentage = Math.min(100, (score / maxScore) * 100);
    let newlyReached = 0;
    getMilestoneThresholds().forEach(threshold => {
      if (percentage < threshold || hintMilestones.has(threshold)) return;
      hintMilestones.add(threshold);
      newlyReached += 1;
    });
    if (!newlyReached) return 0;

    const earned = newlyReached * 2;
    hintCount += earned;
    updateHintCount();
    if (notify) showToast(`達成進度，獲得 ${earned} 個注音提示`);
    return earned;
  }

  function renderHintModal() {
    const list = document.getElementById('hint-results');
    const twoPartButton = document.getElementById('hint-2part-button');
    const threePlusButton = document.getElementById('hint-3plus-button');
    list.replaceChildren();
    revealedHints.forEach((hint, index) => {
      const row = document.createElement('li');
      row.className = 'hint-result';
      const label = document.createElement('span');
      label.className = 'hint-result-label';
      label.textContent = `提示 ${index + 1}`;
      const readings = document.createElement('strong');
      readings.className = 'hint-result-readings';
      readings.textContent = hint.readings.join('／');
      row.append(label, readings);
      list.appendChild(row);
    });

    twoPartButton.disabled = hintCount < 1 || getUncollectedHintTargets(2).length === 0;
    threePlusButton.disabled = hintCount < 2 || getUncollectedHintTargets(3).length === 0;
  }

  function openHintModal() {
    if (!document.getElementById('hint-modal').hidden) {
      closeHintModal();
      return;
    }
    renderHintModal();
    document.getElementById('hint-modal').hidden = false;
    document.getElementById('hint-button').setAttribute('aria-expanded', 'true');
    positionHintModal();
    document.getElementById('hint-close-button').focus({ preventScroll: true });
  }

  function positionHintModal() {
    const buttonRect = document.getElementById('hint-button').getBoundingClientRect();
    const dialog = document.querySelector('.hint-dialog');
    const dialogWidth = dialog.getBoundingClientRect().width;
    const left = Math.max(8, Math.min(
      buttonRect.right - dialogWidth,
      window.innerWidth - dialogWidth - 8
    ));
    dialog.style.left = `${left}px`;
    dialog.style.top = `${buttonRect.bottom + 4}px`;
  }

  function closeHintModal() {
    document.getElementById('hint-modal').hidden = true;
    document.getElementById('hint-button').setAttribute('aria-expanded', 'false');
    document.getElementById('hint-button').focus({ preventScroll: true });
  }

  function getUncollectedHintTargets(minimumPartCount) {
    const eligibleCharacters = new Set();
    allByPartCount.forEach((chars, partCount) => {
      if ((minimumPartCount === 2 && partCount === 2) || (minimumPartCount >= 3 && partCount >= 3)) {
        chars.forEach(char => eligibleCharacters.add(char));
      }
    });
    return [...eligibleCharacters].filter(char =>
      !characters.has(char) && (zhuyinByChar.get(char)?.length || 0) > 0
    );
  }

  function giveZhuyinHint(minimumPartCount) {
    const cost = minimumPartCount === 2 ? 1 : 2;
    if (hintCount < cost) {
      renderHintModal();
      return;
    }
    const uncollected = getUncollectedHintTargets(minimumPartCount);
    if (!uncollected.length) {
      renderHintModal();
      return;
    }

    let candidates = uncollected.filter(char => !hintedCharacters.has(char));
    if (!candidates.length) {
      hintedCharacters.clear();
      candidates = uncollected;
    }
    const char = candidates[Math.floor(Math.random() * candidates.length)];
    const readings = [...zhuyinByChar.get(char)];
    hintedCharacters.add(char);
    revealedHints.push({ char, readings, minimumPartCount });
    hintCount -= cost;
    updateHintCount();
    saveProgress();
    renderHintModal();
    positionHintModal();
  }

  function renderStats() {
    const body = document.getElementById('stats-rows');
    body.replaceChildren();
    const lengths = [...allByPartCount.keys()].sort((a, b) => a - b);
    lengths.forEach(length => {
      const row = document.createElement('tr');
      const category = document.createElement('th');
      category.scope = 'row';
      category.textContent = `${length} 個部件`;
      const count = document.createElement('td');
      count.textContent = `${submittedByPartCount.get(length)?.size || 0}/${allByPartCount.get(length).size} 個字`;
      row.append(category, count);
      body.appendChild(row);
    });
    const ratio = `${characters.size}/${allCharacters.size}`;
    document.getElementById('stats-total').textContent = ratio;
    document.getElementById('stats-grand-total').textContent = `${ratio} 個字`;
  }

  function renderKeyboard(rows) {
    rows.forEach(row => row.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kb-btn';
      button.setAttribute('aria-label', item.variant ? `${item.comp}，變形 ${item.variant}` : item.comp);
      const main = document.createElement('span');
      main.textContent = item.comp;
      button.appendChild(main);
      if (item.variant) {
        const variant = document.createElement('span');
        variant.className = 'kb-variant';
        variant.textContent = `(${item.variant})`;
        button.appendChild(variant);
      }
      button.addEventListener('click', () => addPart(item.comp));
      keyboard.appendChild(button);
    }));

    const backspace = document.createElement('button');
    backspace.id = 'backspace-button';
    backspace.type = 'button';
    backspace.className = 'backspace-key';
    backspace.setAttribute('aria-label', '倒退');
    backspace.title = '倒退 (Backspace)';
    backspace.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6 6-6zM12 10l4 4m0-4-4 4"/></svg>';
    backspace.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      backspace.focus({ preventScroll: true });
      removePart();
    });
    backspace.addEventListener('click', event => {
      if (event.detail === 0) removePart();
    });
    keyboard.appendChild(backspace);
  }

  function setupMenu() {
    const button = document.getElementById('menu-button');
    const menu = document.getElementById('game-menu');
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.getElementById('hint-button').addEventListener('click', openHintModal);
    document.getElementById('hint-close-button').addEventListener('click', closeHintModal);
    document.getElementById('hint-2part-button').addEventListener('click', () => giveZhuyinHint(2));
    document.getElementById('hint-3plus-button').addEventListener('click', () => giveZhuyinHint(3));
    document.getElementById('theme-button').addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      close();
    });
    const statsButton = document.getElementById('stats-button');
    const statsPopover = document.getElementById('stats-popover');
    const closeStats = () => {
      statsPopover.hidden = true;
      statsButton.setAttribute('aria-expanded', 'false');
    };
    statsButton.addEventListener('click', () => {
      statsPopover.hidden = !statsPopover.hidden;
      statsButton.setAttribute('aria-expanded', String(!statsPopover.hidden));
    });
    document.getElementById('share-results-button').addEventListener('click', copyShareResult);
    document.addEventListener('click', event => {
      if (!event.target.closest('.menu-wrap')) close();
      if (!event.target.closest('.stats-wrap')) closeStats();
      if (!document.getElementById('hint-modal').hidden
        && !event.target.closest('.hint-wrap')
        && !event.target.closest('.hint-dialog')) closeHintModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        close();
        closeStats();
        if (!document.getElementById('hint-modal').hidden) closeHintModal();
      }
    });
  }

  document.getElementById('submit-button').addEventListener('click', submitComposition);
  document.addEventListener('keydown', event => {
    if (!document.getElementById('hint-modal').hidden) return;
    if (event.key === 'Backspace') {
      event.preventDefault();
      removePart();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submitComposition();
    }
  });
  setupMenu();

  if ('ResizeObserver' in window) {
    new ResizeObserver(updateCardsPerRow).observe(collectionArea);
  } else {
    window.addEventListener('resize', updateCardsPerRow);
  }
  window.addEventListener('resize', () => {
    if (!document.getElementById('hint-modal').hidden) positionHintModal();
  });
  requestAnimationFrame(updateCardsPerRow);
  tryLockPortrait();

  fetch('./game-data.json')
    .then(response => {
      if (!response.ok) throw new Error(`載入失敗：${response.status}`);
      return response.json();
    })
    .then(data => {
      comboAlternatives = new Map();
      zhuyinByChar = new Map();
      const validEntries = new Set();
      data.charCombos.forEach(item => {
        const key = item.parts.join('+');
        if (!comboAlternatives.has(key)) comboAlternatives.set(key, []);
        if (!comboAlternatives.get(key).includes(item.char)) comboAlternatives.get(key).push(item.char);
        if (!allByPartCount.has(item.parts.length)) allByPartCount.set(item.parts.length, new Set());
        allByPartCount.get(item.parts.length).add(item.char);
        allCharacters.add(item.char);
        if (!zhuyinByChar.has(item.char)) zhuyinByChar.set(item.char, []);
        (Array.isArray(item.zhuyin) ? item.zhuyin : []).forEach(reading => {
          if (typeof reading === 'string' && reading && !zhuyinByChar.get(item.char).includes(reading)) {
            zhuyinByChar.get(item.char).push(reading);
          }
        });
        validEntries.add(`${item.parts.length}:${item.char}`);
        maxParts = Math.max(maxParts, item.parts.length);
      });
      maxScore = [...allByPartCount.entries()].reduce((sum, [partCount, chars]) => sum + partCount * chars.size, 0);
      const availableParts = new Set(data.keyboardRows.flat().map(item => item.comp));
      updateCardsPerRow();
      renderKeyboard(data.keyboardRows);
      restoreProgress(validEntries, availableParts);
    })
    .catch(error => {
      console.error(error);
      showToast('無法載入 game-data.json，請確認使用網頁伺服器開啟');
    });
})();
