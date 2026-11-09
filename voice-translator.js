/* Live, consent-driven speech translation. No microphone starts on page load. */
(() => {
  'use strict';

  const languages = Object.freeze({
    tr: {label: 'التركية', recognition: 'tr-TR', direction: 'ltr'},
    en: {label: 'الإنجليزية', recognition: 'en-US', direction: 'ltr'},
    'zh-CN': {label: 'الصينية (الماندرين)', recognition: 'zh-CN', direction: 'ltr'},
    fr: {label: 'الفرنسية', recognition: 'fr-FR', direction: 'ltr'},
    ku: {label: 'الكردية الكرمانجية', recognition: 'ku-TR', direction: 'ltr'},
    ckb: {label: 'الكردية السورانية', recognition: 'ckb-IQ', direction: 'rtl'}
  });

  // MyMemory limits a single query to 500 UTF-8 bytes. Leave room below that limit.
  function splitText(text, maxBytes = 480) {
    if (!Number.isInteger(maxBytes) || maxBytes < 4) throw new RangeError('Invalid byte limit');
    const encoder = new TextEncoder();
    const chunks = [];
    let current = '';
    for (const word of String(text).trim().split(/\s+/u)) {
      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (encoder.encode(candidate).length <= maxBytes) {
        current = candidate;
        continue;
      }
      if (current) { chunks.push(current); current = ''; }
      for (const character of word) {
        if (encoder.encode(current + character).length > maxBytes) {
          chunks.push(current);
          current = '';
        }
        current += character;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function decodeEntities(text) {
    const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
    return String(text).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code) => {
      if (code[0] !== '#') return named[code.toLowerCase()] || match;
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value) : match;
    });
  }

  window.AlAsemaVoice = Object.freeze({languages, splitText, decodeEntities});

  const byId = id => document.getElementById(id);
  const dialog = byId('translator-dialog');
  if (!dialog) return;
  const ui = {
    language: byId('voice-language'), source: byId('voice-source'), output: byId('voice-output'),
    start: byId('voice-start'), startLabel: byId('voice-start-label'), translate: byId('voice-translate'),
    read: byId('voice-read'), stopAudio: byId('voice-stop-audio'), copy: byId('voice-copy'),
    clear: byId('voice-clear'), autoRead: byId('voice-auto-read'), status: byId('voice-status'),
    statusText: byId('voice-status-text'), support: byId('voice-support'),
    languageNote: byId('voice-language-note'), sourceLabel: byId('voice-source-label'), close: byId('voice-close')
  };
  if (Object.values(ui).some(element => !element)) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  let active = false;
  let recognizing = false;
  let translating = false;
  let speaking = false;
  let recognition = null;
  let restartTimer = null;
  let requestController = null;
  let requestVersion = 0;
  let speechVersion = 0;
  let resolveSpeech = null;
  let noSpeechCount = 0;
  let openedFrom = null;

  try {
    const saved = localStorage.getItem('asema-voice-language');
    if (Object.hasOwn(languages, saved)) ui.language.value = saved;
  } catch { /* Storage is optional. */ }

  const currentLanguage = () => languages[ui.language.value] || languages.en;
  const visible = () => dialog.open && document.visibilityState !== 'hidden';
  const arabicVoice = () => {
    if (!synth || typeof synth.getVoices !== 'function') return null;
    const voices = synth.getVoices().filter(voice => /^ar(?:[-_]|$)/i.test(voice.lang));
    return voices.find(voice => /^ar[-_]SA$/i.test(voice.lang)) || voices[0] || null;
  };

  function status(message, state = 'ready') {
    ui.statusText.textContent = message;
    ui.status.dataset.state = state;
  }

  function updateControls() {
    ui.startLabel.textContent = active ? 'إيقاف الاستماع' : 'ابدأ الترجمة الصوتية';
    ui.start.setAttribute('aria-pressed', String(active));
    ui.start.dataset.active = String(active);
    ui.translate.disabled = translating || speaking || !ui.source.value.trim();
    ui.read.disabled = translating || !ui.output.textContent.trim() || !arabicVoice();
    ui.stopAudio.disabled = !speaking;
    ui.copy.disabled = !ui.output.textContent.trim();
  }

  function updateCapabilities() {
    if (!Recognition || !window.isSecureContext) {
      ui.support.textContent = 'التعرف الصوتي غير متاح في هذا المتصفح. يمكنك كتابة النص وترجمته، أو تجربة Chrome أو Edge عبر اتصال آمن.';
    } else if (!synth || !window.SpeechSynthesisUtterance || !arabicVoice()) {
      ui.support.textContent = 'الترجمة النصية متاحة. لم يُعثر على صوت عربي على هذا الجهاز؛ جرّب متصفحًا أو جهازًا تتوفر فيه أصوات عربية لسماع الترجمة.';
    } else {
      ui.support.textContent = 'تحدّث بجملة قصيرة. تظهر ترجمتها بعد انتهاء الجملة، ثم تُقرأ بالعربية قبل استئناف الاستماع.';
    }
    updateControls();
  }

  function updateLanguage() {
    const language = currentLanguage();
    ui.sourceLabel.textContent = language.label;
    ui.source.dir = language.direction;
    ui.source.lang = ui.language.value;
    const kurdish = ui.language.value === 'ku' || ui.language.value === 'ckb';
    ui.languageNote.hidden = !kurdish;
    ui.languageNote.textContent = kurdish
      ? 'التعرف الصوتي على الكردية يعتمد على دعم المتصفح وقد لا يكون متاحًا. إذا تعذّر، اكتب النص أو الصقه في المربع لترجمته للعربية.' : '';
  }

  function clearRestart() {
    if (restartTimer !== null) clearTimeout(restartTimer);
    restartTimer = null;
  }

  function pauseRecognition() {
    const previous = recognition;
    recognition = null;
    recognizing = false;
    if (previous) {
      previous.onstart = previous.onresult = previous.onerror = previous.onend = null;
      try { previous.abort(); } catch { /* Already stopped. */ }
    }
  }

  function cancelSpeech() {
    speechVersion += 1;
    speaking = false;
    const settle = resolveSpeech;
    resolveSpeech = null;
    if (synth) synth.cancel();
    if (settle) settle(false);
    updateControls();
  }

  function stopEverything(message) {
    active = false;
    clearRestart();
    pauseRecognition();
    requestVersion += 1;
    if (requestController) requestController.abort();
    requestController = null;
    translating = false;
    cancelSpeech();
    if (message) status(message);
    updateControls();
  }

  function scheduleRecognition(delay = 350) {
    clearRestart();
    if (!active || translating || speaking || !visible()) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (active && !translating && !speaking && visible()) startRecognition();
    }, delay);
  }

  function recognitionError(code) {
    if (code === 'no-speech') {
      noSpeechCount += 1;
      if (noSpeechCount < 3 && active) {
        status('لم نلتقط كلامًا بعد. تكلّم بالقرب من الميكروفون.', 'listening');
        scheduleRecognition(700);
        return;
      }
    }
    const messages = {
      'not-allowed': 'لم يُسمح بالميكروفون. فعّل إذنه من إعدادات المتصفح، أو اكتب النص أدناه.',
      'service-not-allowed': 'خدمة التعرف الصوتي غير متاحة في هذا المتصفح. يمكنك كتابة النص وترجمته.',
      'audio-capture': 'تعذّر الوصول إلى الميكروفون. تأكد من توصيله وإتاحة استخدامه.',
      'language-not-supported': `التعرف الصوتي على ${currentLanguage().label} غير مدعوم في هذا المتصفح. اكتب النص أو الصقه لترجمته.`,
      network: 'تعذّر الاتصال بخدمة التعرف الصوتي. تحقّق من الإنترنت ثم أعد المحاولة.',
      'no-speech': 'لم نلتقط كلامًا، فتوقف الاستماع. اضغط ابدأ للمحاولة مجددًا.',
      aborted: 'توقف الاستماع. يمكنك البدء مجددًا أو كتابة النص.'
    };
    stopEverything();
    status(messages[code] || 'تعذّر التعرف على الكلام. جرّب مرة أخرى أو اكتب النص أدناه.', 'error');
  }

  function startRecognition() {
    if (!active || recognition || translating || speaking || !visible()) return;
    if (!Recognition || !window.isSecureContext) {
      recognitionError('service-not-allowed');
      return;
    }
    let instance;
    try { instance = new Recognition(); } catch {
      recognitionError('service-not-allowed');
      return;
    }
    recognition = instance;
    let handled = false;
    instance.lang = currentLanguage().recognition;
    instance.continuous = false;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    instance.onstart = () => {
      if (recognition !== instance || !active) return;
      recognizing = true;
      status(`نستمع الآن باللغة ${currentLanguage().label}…`, 'listening');
      updateControls();
    };
    instance.onresult = event => {
      if (recognition !== instance || !active || handled) return;
      let finalText = '';
      let interimText = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interimText += `${result[0].transcript} `;
      }
      ui.source.value = (finalText || interimText).trim();
      updateControls();
      if (finalText.trim()) {
        handled = true;
        noSpeechCount = 0;
        pauseRecognition();
        void translateSource(finalText.trim());
      }
    };
    instance.onerror = event => {
      if (recognition !== instance) return;
      pauseRecognition();
      recognitionError(event.error);
    };
    instance.onend = () => {
      if (recognition !== instance) return;
      recognition = null;
      recognizing = false;
      if (active && !handled && !translating && !speaking) scheduleRecognition();
    };
    status('ننتظر إذن الميكروفون أو بدء الاستماع…', 'listening');
    try { instance.start(); } catch {
      pauseRecognition();
      recognitionError('audio-capture');
    }
  }

  async function speakArabic(text) {
    pauseRecognition();
    cancelSpeech();
    const voice = arabicVoice();
    if (!voice || !synth || !window.SpeechSynthesisUtterance) {
      updateCapabilities();
      status('ظهرت الترجمة النصية. لا يتوفر صوت عربي على هذا الجهاز.', 'notice');
      return false;
    }
    const version = ++speechVersion;
    speaking = true;
    updateControls();
    status('نقرأ الترجمة العربية…', 'speaking');
    return new Promise(resolve => {
      let completed = false;
      let timer;
      const finish = success => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (version === speechVersion) {
          speaking = false;
          resolveSpeech = null;
          updateControls();
          if (!success && visible()) status('تعذّر تشغيل الصوت العربي. الترجمة النصية متاحة.', 'notice');
        }
        resolve(success);
      };
      resolveSpeech = finish;
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 0.94;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      timer = setTimeout(() => {
        if (version === speechVersion) synth.cancel();
        finish(false);
      }, Math.max(20000, Math.min(120000, text.length * 130)));
      try { synth.resume(); synth.speak(utterance); } catch { finish(false); }
    });
  }

  async function translateSource(rawText) {
    const text = String(rawText).trim();
    if (!text) {
      status('تحدّث أولًا أو اكتب العبارة التي تريد ترجمتها.', 'notice');
      return;
    }
    if (text.length > 1000) {
      stopEverything();
      status('العبارة طويلة. قسّمها إلى جمل أقصر ثم أعد الترجمة.', 'notice');
      return;
    }
    clearRestart();
    pauseRecognition();
    cancelSpeech();
    if (requestController) requestController.abort();
    const controller = new AbortController();
    requestController = controller;
    const version = ++requestVersion;
    const sourceLanguage = ui.language.value;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    translating = true;
    ui.source.value = text;
    ui.output.textContent = '';
    status('نترجم عبارتك إلى العربية…', 'translating');
    updateControls();
    try {
      const translated = [];
      for (const chunk of splitText(text)) {
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', chunk);
        url.searchParams.set('langpair', `${sourceLanguage}|ar`);
        const response = await fetch(url.toString(), {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
        if (!response.ok) throw new Error(response.status === 429 ? 'quota' : 'network');
        const result = await response.json();
        if (result.quotaFinished === true || result.quotaFinished === 1 || Number(result.responseStatus) === 429) throw new Error('quota');
        if (Number(result.responseStatus) !== 200 || typeof result.responseData?.translatedText !== 'string' || !result.responseData.translatedText.trim()) throw new Error('service');
        translated.push(decodeEntities(result.responseData.translatedText));
      }
      if (version !== requestVersion || !visible()) return;
      ui.output.textContent = translated.join(' ');
      translating = false;
      requestController = null;
      updateControls();
      status('الترجمة العربية جاهزة.', 'ready');
      if (ui.autoRead.checked) await speakArabic(ui.output.textContent);
      if (version === requestVersion && active && visible()) scheduleRecognition(500);
    } catch (error) {
      if (version !== requestVersion) return;
      if (error.name === 'AbortError' && !timedOut) return;
      active = false;
      const message = error.message === 'quota'
        ? 'بلغت خدمة الترجمة حد الاستخدام المتاح اليوم. حاول لاحقًا.'
        : timedOut ? 'استغرقت الترجمة وقتًا طويلًا. تحقّق من الإنترنت وحاول مجددًا.'
          : error.message === 'service' ? 'تعذّرت ترجمة هذه العبارة. جرّب جملة أقصر أو أعد المحاولة.'
            : 'تعذّر الاتصال بخدمة الترجمة. تحقّق من الإنترنت ثم أعد المحاولة.';
      status(message, 'error');
    } finally {
      clearTimeout(timer);
      if (version === requestVersion) {
        translating = false;
        requestController = null;
        updateControls();
      }
    }
  }

  function startSession() {
    if (!visible()) return;
    if (!Recognition || !window.isSecureContext) {
      updateCapabilities();
      status('الميكروفون غير مدعوم هنا. اكتب النص في المربع ثم اضغط «ترجم للعربية».', 'notice');
      ui.source.focus();
      return;
    }
    stopEverything();
    active = true;
    noSpeechCount = 0;
    updateCapabilities();
    updateControls();
    startRecognition();
  }

  document.addEventListener('click', event => {
    const opener = event.target.closest('[data-action="voice-translator"]');
    if (!opener) return;
    openedFrom = opener;
    updateLanguage();
    updateCapabilities();
    if (!dialog.open) dialog.showModal();
    status('اختر لغة الكلام، ثم ابدأ أو اكتب عبارتك للترجمة.');
  });

  ui.start.addEventListener('click', () => {
    if (active) stopEverything('توقف الاستماع. اضغط ابدأ عندما تريد المتابعة.');
    else startSession();
  });
  ui.translate.addEventListener('click', () => { void translateSource(ui.source.value); });
  ui.read.addEventListener('click', async () => {
    const version = requestVersion;
    const read = await speakArabic(ui.output.textContent);
    if (version === requestVersion && visible()) {
      if (read) status('اكتملت قراءة الترجمة العربية.');
      scheduleRecognition(500);
    }
  });
  ui.stopAudio.addEventListener('click', () => {
    cancelSpeech();
    status('توقفت قراءة الترجمة.');
    scheduleRecognition(500);
  });
  ui.autoRead.addEventListener('change', () => {
    if (!ui.autoRead.checked && speaking) {
      cancelSpeech();
      scheduleRecognition(500);
    }
  });
  ui.source.addEventListener('input', () => {
    if (active || translating || speaking) stopEverything('عدّل العبارة، ثم اضغط «ترجم للعربية».');
    updateControls();
  });
  ui.language.addEventListener('change', () => {
    stopEverything('تم تغيير اللغة. ابدأ الاستماع أو اكتب العبارة الجديدة.');
    ui.source.value = '';
    ui.output.textContent = '';
    try { localStorage.setItem('asema-voice-language', ui.language.value); } catch { /* Optional. */ }
    updateLanguage();
    updateCapabilities();
  });
  ui.clear.addEventListener('click', () => {
    stopEverything('تم المسح. اختر لغة وابدأ من جديد.');
    ui.source.value = '';
    ui.output.textContent = '';
    updateControls();
    ui.source.focus();
  });
  ui.copy.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard');
      await navigator.clipboard.writeText(ui.output.textContent);
      status(recognizing ? 'تم نسخ الترجمة — الميكروفون يعمل.' : 'تم نسخ الترجمة العربية.', recognizing ? 'listening' : 'ready');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(ui.output);
      const selection = window.getSelection();
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      status('حدّدنا الترجمة. استخدم أمر النسخ من جهازك.', 'notice');
    }
  });
  ui.close.addEventListener('click', () => {
    stopEverything();
    if (window.AlAsemaMotion) window.AlAsemaMotion.closeDialog(dialog);
    else dialog.close();
  });
  dialog.addEventListener('dialogclosing', () => stopEverything());
  dialog.addEventListener('cancel', () => stopEverything());
  dialog.addEventListener('close', () => {
    stopEverything();
    if (openedFrom?.isConnected) openedFrom.focus({preventScroll: true});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopEverything('توقف الاستماع عند مغادرة الصفحة. اضغط ابدأ للمتابعة.');
  });
  window.addEventListener('pagehide', () => stopEverything());
  if (synth?.addEventListener) synth.addEventListener('voiceschanged', updateCapabilities);
  updateLanguage();
  updateCapabilities();
})();
