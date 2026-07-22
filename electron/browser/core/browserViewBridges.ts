import type { BrowserViewRecord } from "./browserViewTypes";

const BROWSER_IMAGE_DRAG_MIME = "application/x-nomi-browser-image";
export const BROWSER_IMAGE_DRAG_START_CONSOLE_PREFIX = "__NOMI_BROWSER_IMAGE_DRAG_START__";
export const BROWSER_IMAGE_DRAG_END_CONSOLE_MESSAGE = "__NOMI_BROWSER_IMAGE_DRAG_END__";
export const BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX = "__NOMI_BROWSER_IMAGE_PROMPT__";
export const BROWSER_TEXT_PROMPT_CONSOLE_PREFIX = "__NOMI_BROWSER_TEXT_PROMPT__";

export async function installBrowserImageDragBridge(record: BrowserViewRecord): Promise<void> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return;
  const script = `
(() => {
  const dragMime = ${JSON.stringify(BROWSER_IMAGE_DRAG_MIME)};
  if (window.__nomiBrowserImageDragBridgeInstalled) return true;
  window.__nomiBrowserImageDragBridgeInstalled = true;
  const pickMediaElement = (target) => {
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) return target;
    const closestMedia = target.closest ? target.closest('img,video') : null;
    if (closestMedia) return closestMedia;
    const container = target.closest ? target.closest('[draggable="true"],a,picture,figure') : null;
    return container?.querySelector ? container.querySelector('img,video') : null;
  };
  const readBackgroundUrl = (target) => {
    if (!(target instanceof Element)) return '';
    const candidates = [target, target.closest?.('[draggable="true"],a,figure')].filter(Boolean);
    for (const candidate of candidates) {
      const value = getComputedStyle(candidate).backgroundImage || '';
      const match = value.match(/url\\(["']?(.+?)["']?\\)/i);
      if (match?.[1]) return match[1];
    }
    return '';
  };
  const readMedia = (target) => {
    const media = pickMediaElement(target);
    if (media instanceof HTMLVideoElement) {
      const videoUrl = media.currentSrc || media.src || media.querySelector('source')?.src || '';
      return {
        element: media,
        url: videoUrl || media.poster || '',
        mediaType: videoUrl ? 'video' : 'image',
      };
    }
    if (media instanceof HTMLImageElement) {
      return {
        element: media,
        url: media.currentSrc || media.src || media.getAttribute('data-src') || media.getAttribute('data-original') || media.getAttribute('data-lazy-src') || '',
        mediaType: 'image',
      };
    }
    return { element: target instanceof Element ? target : null, url: readBackgroundUrl(target), mediaType: 'image' };
  };
  document.addEventListener('dragstart', (event) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const media = readMedia(event.target);
    const rawUrl = media.url;
    if (!rawUrl) return;
    let url = '';
    try {
      url = new URL(rawUrl, window.location.href).href;
    } catch {
      return;
    }
    const title = (media.element?.getAttribute?.('alt') || media.element?.getAttribute?.('title') || document.title || '').trim();
    const payload = {
      url,
      title,
      mediaType: media.mediaType,
      pageUrl: window.location.href,
      pageTitle: document.title || '',
    };
    try { transfer.setData(dragMime, JSON.stringify(payload)); } catch {}
    try { transfer.setData('text/uri-list', url); } catch {}
    try { transfer.setData('text/plain', url); } catch {}
    transfer.effectAllowed = 'copy';
    try { console.info(${JSON.stringify(BROWSER_IMAGE_DRAG_START_CONSOLE_PREFIX)} + JSON.stringify(payload)); } catch {}
  }, true);
  document.addEventListener('dragend', () => {
    try { console.info(${JSON.stringify(BROWSER_IMAGE_DRAG_END_CONSOLE_MESSAGE)}); } catch {}
  }, true);
  document.addEventListener('drop', () => {
    try { console.info(${JSON.stringify(BROWSER_IMAGE_DRAG_END_CONSOLE_MESSAGE)}); } catch {}
  }, true);
  return true;
})()
`;
  try {
    await contents.executeJavaScript(script, true);
  } catch {
    // Some pages reject script execution during transient navigation states; the next load event retries.
  }
}

export async function installBrowserPromptHoverBridge(record: BrowserViewRecord): Promise<void> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return;
  const script = `
(() => {
  const consolePrefix = ${JSON.stringify(BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX)};
  const promptCategories = ${JSON.stringify(record.promptCategories)};
  const normalizePromptCategories = (input) => {
    const output = [];
    const seen = new Set();
    const push = (idValue, labelValue) => {
      const id = String(idValue || '').trim();
      const label = String(labelValue || '').trim();
      if (!id || !label || seen.has(id)) return;
      seen.add(id);
      output.push({ id, label });
    };
    push('image', '图片提示词');
    push('video', '视频提示词');
    if (Array.isArray(input)) {
      input.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        push(item.id, item.label);
      });
    }
    return output;
  };
  window.__nomiBrowserPromptCategories = normalizePromptCategories(promptCategories);
  if (window.__nomiBrowserPromptHoverBridgeInstalled) {
    if (typeof window.__nomiBrowserRenderPromptCategories === 'function') {
      window.__nomiBrowserRenderPromptCategories();
    }
    return true;
  }
  window.__nomiBrowserPromptHoverBridgeInstalled = true;

  const state = {
    image: null,
    visible: false,
    menuOpen: false,
  };
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Nomi 获取提示词');
  button.innerHTML = '<span class="nomi-prompt-mark">N</span><span>获取提示词</span>';
  button.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'display:none',
    'align-items:center',
    'gap:6px',
    'height:28px',
    'max-width:128px',
    'padding:0 9px 0 6px',
    'border:1px solid rgba(255,255,255,.72)',
    'border-radius:999px',
    'background:rgba(18,24,38,.88)',
    'color:white',
    'font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'box-shadow:0 8px 22px rgba(15,23,42,.24)',
    'backdrop-filter:blur(8px)',
    'cursor:pointer',
    'user-select:none',
    'white-space:nowrap'
  ].join(';');
  const style = document.createElement('style');
  style.textContent = '.nomi-prompt-mark{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:999px;background:#fff;color:#111827;font:800 11px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.nomi-prompt-mode-option{display:flex;width:100%;align-items:flex-start;gap:8px;border:0;background:transparent;color:#172033;padding:8px;border-radius:10px;text-align:left;cursor:pointer;font:500 12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.nomi-prompt-mode-option:hover{background:rgba(35,43,64,.07)}.nomi-prompt-mode-icon{display:inline-grid;width:20px;height:20px;place-items:center;border-radius:999px;background:#172033;color:white;font:800 11px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.nomi-prompt-mode-title{display:block;font-weight:700;color:#172033}.nomi-prompt-mode-desc{display:block;margin-top:2px;color:rgba(23,32,51,.62)}';
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(button);
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '选择提示词提取方式');
  menu.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'display:none',
    'width:188px',
    'padding:5px',
    'border:1px solid rgba(23,32,51,.14)',
    'border-radius:14px',
    'background:rgba(255,255,255,.96)',
    'box-shadow:0 16px 38px rgba(15,23,42,.20)',
    'backdrop-filter:blur(10px)',
    'user-select:none'
  ].join(';');
  const createModeOption = (mode, title, description) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'nomi-prompt-mode-option';
    option.setAttribute('role', 'menuitem');
    option.setAttribute('data-nomi-prompt-mode', mode);
    option.innerHTML = '<span class="nomi-prompt-mode-icon">' + (mode === 'style' ? 'S' : 'R') + '</span><span><span class="nomi-prompt-mode-title">' + title + '</span><span class="nomi-prompt-mode-desc">' + description + '</span></span>';
    return option;
  };
  menu.appendChild(createModeOption('replicate', '画面复刻', '还原主体、构图、光影与细节'));
  menu.appendChild(createModeOption('style', '画面风格', '提取配色、字体、构图与效果 JSON'));
  document.documentElement.appendChild(menu);

  const cleanTitle = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const absoluteUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.href).href;
      return /^(https?:\\/\\/|blob:|data:image\\/)/i.test(url) ? url : '';
    } catch {
      return '';
    }
  };
  const readImageUrl = (image) => {
    if (!image) return '';
    return absoluteUrl(
      image.currentSrc ||
        image.src ||
        image.getAttribute('data-src') ||
        image.getAttribute('data-original') ||
        image.getAttribute('data-lazy-src')
    );
  };
  const fileNameFromUrl = (url) => {
    try {
      const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
      return segment ? decodeURIComponent(segment) : '';
    } catch {
      return '';
    }
  };
  const rectFromImage = (image) => {
    const rect = image.getBoundingClientRect();
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const left = Math.max(0, Math.min(viewportWidth, rect.left));
    const top = Math.max(0, Math.min(viewportHeight, rect.top));
    const right = Math.max(left, Math.min(viewportWidth, rect.right));
    const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom));
    return { left, top, width: right - left, height: bottom - top };
  };
  const usableImage = (image) => {
    if (!(image instanceof HTMLImageElement)) return false;
    const rect = rectFromImage(image);
    if (rect.width < 64 || rect.height < 64) return false;
    return Boolean(readImageUrl(image));
  };
  const showForImage = (image) => {
    if (!usableImage(image)) return hide();
    state.image = image;
    const rect = rectFromImage(image);
    const buttonWidth = Math.min(128, Math.max(92, button.offsetWidth || 112));
    const left = Math.max(8, Math.min(window.innerWidth - buttonWidth - 8, rect.left + rect.width - buttonWidth - 8));
    const top = Math.max(8, Math.min(window.innerHeight - 36, rect.top + 8));
    button.style.left = left + 'px';
    button.style.top = top + 'px';
    button.style.display = 'inline-flex';
    if (state.menuOpen) positionMenu();
    state.visible = true;
  };
  const positionMenu = () => {
    const buttonRect = button.getBoundingClientRect();
    const menuWidth = 188;
    const menuHeight = 102;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, buttonRect.right - menuWidth));
    const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, buttonRect.bottom + 6));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  };
  const closeMenu = () => {
    state.menuOpen = false;
    menu.style.display = 'none';
  };
  const openMenu = () => {
    if (!state.image || !readImageUrl(state.image)) return;
    state.menuOpen = true;
    positionMenu();
    menu.style.display = 'block';
  };
  const hide = () => {
    state.image = null;
    state.visible = false;
    button.style.display = 'none';
    closeMenu();
  };
  const imageFromEvent = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLImageElement) return target;
    return target.closest ? target.closest('img') : null;
  };
  document.addEventListener('pointerover', (event) => {
    const image = imageFromEvent(event);
    if (image) showForImage(image);
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (event.target === button || button.contains(event.target) || event.target === menu || menu.contains(event.target)) return;
    const image = imageFromEvent(event);
    if (image) showForImage(image);
    else if (state.visible) {
      const rect = button.getBoundingClientRect();
      const insideButton = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      const menuRect = menu.getBoundingClientRect();
      const insideMenu = state.menuOpen && event.clientX >= menuRect.left && event.clientX <= menuRect.right && event.clientY >= menuRect.top && event.clientY <= menuRect.bottom;
      const imageRect = state.image ? rectFromImage(state.image) : null;
      const insideImage = imageRect && event.clientX >= imageRect.left && event.clientX <= imageRect.left + imageRect.width && event.clientY >= imageRect.top && event.clientY <= imageRect.top + imageRect.height;
      if (!insideButton && !insideMenu && !insideImage) hide();
    }
  }, true);
  document.addEventListener('scroll', () => {
    if (state.image && document.documentElement.contains(state.image)) showForImage(state.image);
    else hide();
  }, true);
  window.addEventListener('resize', () => {
    if (state.image) showForImage(state.image);
  });
  const sendPromptRequest = (extractionMode) => {
    const image = state.image;
    const url = readImageUrl(image);
    if (!image || !url) return;
    const rect = rectFromImage(image);
    const payload = {
      url,
      title: cleanTitle(image.alt || image.title || image.getAttribute('aria-label') || document.title),
      fileName: fileNameFromUrl(url),
      pageUrl: window.location.href,
      pageTitle: document.title || '',
      extractionMode,
      sourceRect: rect,
    };
    try { console.info(consolePrefix + JSON.stringify(payload)); } catch {}
    hide();
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.menuOpen) closeMenu();
    else openMenu();
  });
  menu.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const option = event.target instanceof Element ? event.target.closest('[data-nomi-prompt-mode]') : null;
    if (!option) return;
    sendPromptRequest(option.getAttribute('data-nomi-prompt-mode') === 'style' ? 'style' : 'replicate');
  });

  const textConsolePrefix = ${JSON.stringify(BROWSER_TEXT_PROMPT_CONSOLE_PREFIX)};
  const textState = { text: '', rect: null, cardOpen: false };
  const textButton = document.createElement('button');
  textButton.type = 'button';
  textButton.setAttribute('aria-label', 'Nomi 保存提示词');
  textButton.innerHTML = '<span class="nomi-prompt-mark">N</span><span>保存提示词</span>';
  textButton.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'display:none',
    'align-items:center',
    'gap:6px',
    'height:30px',
    'padding:0 10px 0 6px',
    'border:1px solid rgba(255,255,255,.72)',
    'border-radius:999px',
    'background:rgba(18,24,38,.9)',
    'color:white',
    'font:650 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'box-shadow:0 10px 26px rgba(15,23,42,.28)',
    'backdrop-filter:blur(8px)',
    'cursor:pointer',
    'user-select:none',
    'white-space:nowrap'
  ].join(';');
  document.documentElement.appendChild(textButton);

  const textCard = document.createElement('div');
  textCard.setAttribute('role', 'dialog');
  textCard.setAttribute('aria-label', '保存提示词');
  textCard.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'display:none',
    'width:min(420px,calc(100vw - 32px))',
    'padding:12px',
    'border:1px solid rgba(23,32,51,.14)',
    'border-radius:16px',
    'background:rgba(255,255,255,.97)',
    'box-shadow:0 22px 58px rgba(15,23,42,.28)',
    'color:#172033',
    'font:500 13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'backdrop-filter:blur(10px)'
  ].join(';');
  textCard.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">' +
      '<strong style="font-size:14px">保存提示词</strong>' +
      '<button type="button" data-nomi-text-close style="border:0;background:transparent;color:rgba(23,32,51,.55);font-size:18px;line-height:1;cursor:pointer">×</button>' +
    '</div>' +
    '<div style="display:grid;gap:10px">' +
      '<div style="display:grid;place-items:center;min-height:72px;border-radius:12px;background:rgba(23,32,51,.06);color:rgba(23,32,51,.48);font-size:12px">无参考图</div>' +
      '<label style="display:grid;gap:5px"><span style="color:rgba(23,32,51,.62);font-size:12px">提示词类型</span><select data-nomi-text-type style="height:34px;border:1px solid rgba(23,32,51,.14);border-radius:10px;background:white;padding:0 8px;color:#172033"><option value="image">图片提示词</option><option value="video">视频提示词</option></select></label>' +
      '<label style="display:grid;gap:5px"><span style="color:rgba(23,32,51,.62);font-size:12px">选中文字</span><textarea data-nomi-text-value style="min-height:110px;resize:vertical;border:1px solid rgba(23,32,51,.14);border-radius:10px;background:white;padding:8px;color:#172033;font:500 13px/1.55 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"></textarea></label>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-nomi-text-cancel style="height:32px;border:1px solid rgba(23,32,51,.14);border-radius:10px;background:white;color:rgba(23,32,51,.72);padding:0 12px;cursor:pointer">取消</button><button type="button" data-nomi-text-save style="height:32px;border:0;border-radius:10px;background:#172033;color:white;padding:0 12px;font-weight:700;cursor:pointer">保存</button></div>' +
    '</div>';
  document.documentElement.appendChild(textCard);

  const getPromptCategories = () => {
    const categories = normalizePromptCategories(window.__nomiBrowserPromptCategories);
    return categories.length ? categories : normalizePromptCategories([]);
  };
  const renderPromptCategoryOptions = () => {
    const select = textCard.querySelector('[data-nomi-text-type]');
    if (!select) return;
    const categories = getPromptCategories();
    const currentValue = String(select.value || 'image');
    select.textContent = '';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.id;
      option.textContent = category.label;
      select.appendChild(option);
    });
    select.value = categories.some((category) => category.id === currentValue)
      ? currentValue
      : (categories.find((category) => category.id === 'image')?.id || categories[0]?.id || 'image');
  };
  window.__nomiBrowserRenderPromptCategories = renderPromptCategoryOptions;
  renderPromptCategoryOptions();

  const hideTextButton = () => {
    if (textState.cardOpen) return;
    textButton.style.display = 'none';
  };
  const closeTextCard = () => {
    textState.cardOpen = false;
    textCard.style.display = 'none';
    hideTextButton();
  };
  const selectionRect = (selection) => {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height) return rect;
    const first = range.getClientRects()[0];
    return first || null;
  };
  const updateTextSelection = () => {
    if (textState.cardOpen) return;
    const selection = window.getSelection();
    const text = selection ? String(selection.toString() || '').trim() : '';
    if (!selection || !text) {
      hideTextButton();
      return;
    }
    const anchorElement = selection.anchorNode && (selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement);
    if (anchorElement && anchorElement.closest && anchorElement.closest('button,input,textarea,select,[contenteditable="true"],.nomi-prompt-mode-option')) return;
    const rect = selectionRect(selection);
    if (!rect) {
      hideTextButton();
      return;
    }
    textState.text = text;
    textState.rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const buttonWidth = Math.min(132, Math.max(106, textButton.offsetWidth || 118));
    textButton.style.left = Math.max(8, Math.min(window.innerWidth - buttonWidth - 8, rect.left + rect.width / 2 - buttonWidth / 2)) + 'px';
    textButton.style.top = Math.max(8, rect.top - 38) + 'px';
    textButton.style.display = 'inline-flex';
  };
  const openTextCard = () => {
    if (!textState.text) return;
    textState.cardOpen = true;
    const textarea = textCard.querySelector('[data-nomi-text-value]');
    const select = textCard.querySelector('[data-nomi-text-type]');
    if (textarea) textarea.value = textState.text;
    renderPromptCategoryOptions();
    if (select) select.value = getPromptCategories().some((category) => category.id === 'image') ? 'image' : select.value;
    const rect = textState.rect || { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const cardWidth = Math.min(420, window.innerWidth - 32);
    textCard.style.left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2)) + 'px';
    textCard.style.top = Math.max(16, Math.min(window.innerHeight - 360, rect.top + rect.height + 10)) + 'px';
    textCard.style.display = 'block';
  };
  const saveTextCard = () => {
    const textarea = textCard.querySelector('[data-nomi-text-value]');
    const select = textCard.querySelector('[data-nomi-text-type]');
    const prompt = textarea ? String(textarea.value || '').trim() : '';
    if (!prompt) return;
    const payload = {
      prompt,
      promptType: select ? String(select.value || 'image').trim() || 'image' : 'image',
      pageUrl: window.location.href,
      pageTitle: document.title || '',
    };
    try { console.info(textConsolePrefix + JSON.stringify(payload)); } catch {}
    closeTextCard();
    try { window.getSelection()?.removeAllRanges(); } catch {}
  };
  textButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTextCard();
  });
  textCard.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-nomi-text-save]')) saveTextCard();
    if (target?.closest('[data-nomi-text-close],[data-nomi-text-cancel]')) closeTextCard();
  });
  document.addEventListener('pointerup', () => window.setTimeout(updateTextSelection, 0), true);
  document.addEventListener('keyup', () => window.setTimeout(updateTextSelection, 0), true);
  document.addEventListener('selectionchange', () => window.setTimeout(updateTextSelection, 0));
  document.addEventListener('scroll', hideTextButton, true);
  window.addEventListener('resize', hideTextButton);
  return true;
})()
`;
  try {
    await contents.executeJavaScript(script, true);
  } catch {
    // The next DOM-ready/load event retries.
  }
}

// 资源捕捞桥脚本抽成纯函数：jsdom 单测可直接 eval 验证「候选冻结」不变量
// （2026-07-22 审计 L0：保存时重新 pickAt 会让用户保存到与所见不同的资源）。
export function resourceCaptureBridgeScript(enabled: boolean): string {
  return `
(() => {
  const enabled = ${enabled ? "true" : "false"};
  const imagePattern = /\\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;
  const videoPattern = /\\.(?:mp4|webm|mov|m4v|mkv|avi|m3u8)(?:[?#]|$)/i;
  const state = window.__nomiBrowserResourceCaptureBridge || {
    installed: false,
    enabled: false,
    current: null,
    target: null,
  };
  const absoluteUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.href).href;
      return /^(https?:\\/\\/|blob:)/i.test(url) ? url : '';
    } catch {
      return '';
    }
  };
  const mediaTypeFromUrl = (url) => {
    if (imagePattern.test(url)) return 'image';
    if (videoPattern.test(url)) return 'video';
    return '';
  };
  const cleanTitle = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const fileNameFromUrl = (url) => {
    try {
      const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
      return segment ? decodeURIComponent(segment) : '';
    } catch {
      return '';
    }
  };
  const rectFromElement = (element) => {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    const rect = element.getBoundingClientRect();
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const left = Math.max(0, Math.min(viewportWidth, rect.left));
    const top = Math.max(0, Math.min(viewportHeight, rect.top));
    const right = Math.max(left, Math.min(viewportWidth, rect.right));
    const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom));
    const width = right - left;
    const height = bottom - top;
    if (width <= 1 || height <= 1) return null;
    return { left, top, width, height };
  };
  const rectContainsPoint = (rect, clientX, clientY) => {
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.left + rect.width && clientY >= rect.top && clientY <= rect.top + rect.height;
  };
  const candidateContainsPoint = (candidate, clientX, clientY) => {
    return !candidate?.payload?.sourceRect || rectContainsPoint(candidate.payload.sourceRect, clientX, clientY);
  };
  const pointedDescendant = (element, selector, clientX, clientY) => {
    const nodes = Array.from(element.querySelectorAll?.(selector) || []);
    let best = null;
    let bestArea = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const rect = rectFromElement(node);
      if (!rectContainsPoint(rect, clientX, clientY)) continue;
      const area = rect.width * rect.height;
      if (area < bestArea) {
        best = node;
        bestArea = area;
      }
    }
    return best;
  };
  const makeCandidate = (element, rawUrl, mediaType, title) => {
    const url = absoluteUrl(rawUrl);
    if (!url) return null;
    const resolvedMediaType = mediaType || mediaTypeFromUrl(url);
    if (resolvedMediaType !== 'image' && resolvedMediaType !== 'video') return null;
    return {
      element,
      payload: {
        url,
        mediaType: resolvedMediaType,
        title: cleanTitle(title) || cleanTitle(element?.getAttribute?.('alt')) || cleanTitle(element?.getAttribute?.('title')) || cleanTitle(document.title),
        fileName: fileNameFromUrl(url),
        pageUrl: window.location.href,
        pageTitle: document.title || '',
        sourceRect: rectFromElement(element),
      },
    };
  };
  const candidateFromMediaElement = (element) => {
    if (!element || !(element instanceof Element)) return null;
    if (element instanceof HTMLImageElement) {
      return makeCandidate(
        element,
        element.currentSrc || element.src || element.getAttribute('data-src') || element.getAttribute('data-original') || element.getAttribute('data-lazy-src'),
        'image',
        element.alt || element.title,
      );
    }
    if (element instanceof HTMLVideoElement) {
      const source = element.currentSrc || element.src || element.querySelector('source[src]')?.getAttribute('src');
      if (source) return makeCandidate(element, source, 'video', element.title || element.getAttribute('aria-label'));
      const poster = element.poster || element.getAttribute('poster');
      if (poster) return makeCandidate(element, poster, 'image', element.title || element.getAttribute('aria-label'));
    }
    if (element instanceof HTMLSourceElement) {
      const parent = element.parentElement;
      const mediaType = parent instanceof HTMLVideoElement || /^video\\//i.test(element.type || '') ? 'video' : 'image';
      return makeCandidate(parent || element, element.src || element.getAttribute('src'), mediaType, element.title);
    }
    return null;
  };
  const candidateFromLink = (element) => {
    if (!(element instanceof HTMLAnchorElement)) return null;
    const href = absoluteUrl(element.href || element.getAttribute('href'));
    const mediaType = mediaTypeFromUrl(href);
    if (!mediaType) return null;
    return makeCandidate(element, href, mediaType, element.textContent || element.title || element.getAttribute('aria-label'));
  };
  const candidateFromBackground = (element) => {
    if (!element || !(element instanceof Element)) return null;
    const background = window.getComputedStyle(element).backgroundImage || '';
    const match = background.match(/url\\((['"]?)(.*?)\\1\\)/);
    if (!match) return null;
    return makeCandidate(element, match[2], 'image', element.getAttribute('aria-label') || element.textContent);
  };
  const candidateFromElement = (element, clientX, clientY) => {
    if (!element || !(element instanceof Element)) return null;
    const direct = candidateFromMediaElement(element);
    if (direct && candidateContainsPoint(direct, clientX, clientY)) return direct;
    const closestMedia = element.closest?.('img,video,source');
    const fromClosestMedia = closestMedia ? candidateFromMediaElement(closestMedia) : null;
    if (fromClosestMedia && candidateContainsPoint(fromClosestMedia, clientX, clientY)) return fromClosestMedia;
    const pointedMedia = pointedDescendant(element, 'img,video', clientX, clientY);
    const fromPointedMedia = pointedMedia ? candidateFromMediaElement(pointedMedia) : null;
    if (fromPointedMedia) return fromPointedMedia;
    const closestLink = element.closest?.('a[href]');
    const fromClosestLink = closestLink ? candidateFromLink(closestLink) : null;
    if (fromClosestLink && candidateContainsPoint(fromClosestLink, clientX, clientY)) return fromClosestLink;
    const pointedLink = pointedDescendant(element, 'a[href]', clientX, clientY);
    const fromPointedLink = pointedLink ? candidateFromLink(pointedLink) : null;
    if (fromPointedLink) return fromPointedLink;
    const background = candidateFromBackground(element);
    if (background && candidateContainsPoint(background, clientX, clientY)) return background;
    return null;
  };
  const setTarget = (candidate) => {
    if (state.target && state.target !== candidate?.element) {
      try { state.target.removeAttribute('data-nomi-resource-capture-target'); } catch {}
    }
    state.target = candidate?.element || null;
    state.current = candidate?.payload || null;
  };
  const pickAt = (clientX, clientY) => {
    const elements = document.elementsFromPoint(clientX, clientY);
    for (const element of elements) {
      const candidate = candidateFromElement(element, clientX, clientY);
      if (candidate) return candidate;
    }
    return null;
  };
  const handlePointerMove = (event) => {
    if (!state.enabled) return;
    setTarget(pickAt(event.clientX, event.clientY));
  };
  const handlePointerLeave = () => {
    if (!state.enabled) return;
    setTarget(null);
  };
  if (!state.installed) {
    state.installed = true;
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerleave', handlePointerLeave, true);
  }
  if (state.style) {
    try { state.style.remove(); } catch {}
    state.style = null;
  }
  state.enabled = enabled;
  if (!enabled) setTarget(null);
  window.__nomiBrowserResourceCaptureBridge = state;
  window.__nomiReadBrowserResourceCapture = () => {
    // 候选冻结（审计 L0）：保存读的是高亮那一刻的候选，绝不按坐标重新 pick——
    // hover 换图站点（YouTube 动图缩略等）重拾会拿到与用户所见不同的 URL。
    return state.current ? { ...state.current } : null;
  };
  return true;
})()
`;
}

export async function installBrowserResourceCaptureBridge(record: BrowserViewRecord, enabled: boolean): Promise<void> {
  const contents = record.view.webContents;
  if (contents.isDestroyed()) return;
  try {
    await contents.executeJavaScript(resourceCaptureBridgeScript(enabled), true);
  } catch {
    // Pages can be between navigations; dom-ready and load events reinstall while the mode remains active.
  }
}

